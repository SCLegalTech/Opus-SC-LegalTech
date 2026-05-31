const db = require('../config/db');
const { analyzeCase } = require('../services/caseIntelligence.service');

async function getCaseContext(caseId) {
  const { rows } = await db.query(`
    SELECT c.*,
           cl.full_name AS client_name,
           cl.document_number AS client_document,
           cl.email AS client_email,
           cl.phone AS client_phone,
           u.name AS assigned_to_name
    FROM cases c
    LEFT JOIN clients cl ON c.client_id = cl.id
    LEFT JOIN users u ON c.assigned_to = u.id
    WHERE c.id = $1
  `, [caseId]);
  return rows[0] || null;
}

function normalizeSourceType(value) {
  const allowed = new Set(['nota', 'llamada', 'correo', 'documento', 'transcripcion', 'otro']);
  return allowed.has(value) ? value : 'nota';
}

const getAnalyses = async (req, res) => {
  const caseId = req.params.caseId;
  try {
    const { rows } = await db.query(`
      SELECT
        a.*,
        ar.provider,
        ar.model,
        ar.prompt_version,
        ar.error AS provider_error,
        COALESCE(
          json_agg(
            json_build_object(
              'id', s.id,
              'suggestion_type', s.suggestion_type,
              'title', s.title,
              'payload', s.payload,
              'confidence', s.confidence,
              'status', s.status,
              'result_table', s.result_table,
              'result_id', s.result_id,
              'applied_at', s.applied_at
            )
            ORDER BY s.id
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS suggestions
      FROM case_ai_analyses a
      LEFT JOIN agent_runs ar ON ar.id = a.agent_run_id
      LEFT JOIN case_ai_suggestions s ON s.analysis_id = a.id
      WHERE a.case_id = $1
      GROUP BY a.id, ar.provider, ar.model, ar.prompt_version, ar.error
      ORDER BY a.created_at DESC
      LIMIT 10
    `, [caseId]);

    res.json(rows);
  } catch (err) {
    console.error('getAnalyses:', err);
    res.status(500).json({ error: 'Error obteniendo analisis de Sala' });
  }
};

const createAnalysis = async (req, res) => {
  const caseId = req.params.caseId;
  const { source_text, source_type } = req.body;

  try {
    const caseData = await getCaseContext(caseId);
    if (!caseData) return res.status(404).json({ error: 'Caso no encontrado' });

    const result = await analyzeCase({
      caseData,
      sourceText: source_text,
      sourceType: normalizeSourceType(source_type),
    });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const runStatus = result.provider_error ? 'completed_with_fallback' : 'completed';
      const { rows: [run] } = await client.query(`
        INSERT INTO agent_runs
          (provider, model, purpose, prompt_version, input_hash, input_tokens, output_tokens,
           status, error, metadata, created_by)
        VALUES ($1,$2,'case_analysis',$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `, [
        result.provider,
        result.model,
        result.prompt_version,
        result.input_hash,
        result.usage?.prompt_tokens || null,
        result.usage?.completion_tokens || null,
        runStatus,
        result.provider_error || null,
        JSON.stringify({ usage: result.usage || null }),
        req.user.id,
      ]);

      const { rows: [analysis] } = await client.query(`
        INSERT INTO case_ai_analyses
          (case_id, agent_run_id, source_type, source_text, analysis, created_by)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
      `, [
        caseId,
        run.id,
        normalizeSourceType(source_type),
        source_text.trim(),
        JSON.stringify(result.analysis),
        req.user.id,
      ]);

      const insertedSuggestions = [];
      for (const suggestion of result.suggestions) {
        const { rows: [row] } = await client.query(`
          INSERT INTO case_ai_suggestions
            (analysis_id, suggestion_type, title, payload, confidence)
          VALUES ($1,$2,$3,$4,$5)
          RETURNING *
        `, [
          analysis.id,
          suggestion.suggestion_type,
          suggestion.title,
          JSON.stringify(suggestion.payload),
          suggestion.confidence || null,
        ]);
        insertedSuggestions.push(row);
      }

      await client.query(`
        INSERT INTO communications (case_id, type, content, metadata, created_by)
        VALUES ($1, 'note', $2, $3, $4)
      `, [
        caseId,
        `Sala: analisis generado (${insertedSuggestions.length} sugerencias).`,
        JSON.stringify({ analysis_id: analysis.id, provider: result.provider, model: result.model }),
        req.user.id,
      ]);

      await client.query('COMMIT');
      res.status(201).json({
        ...analysis,
        provider: result.provider,
        model: result.model,
        prompt_version: result.prompt_version,
        provider_error: result.provider_error || null,
        suggestions: insertedSuggestions,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('createAnalysis:', err);
    res.status(err.status || 500).json({ error: err.message || 'Error generando analisis de Sala' });
  }
};

async function applySuggestion(client, { caseId, suggestion, userId }) {
  const payload = suggestion.payload || {};

  if (suggestion.suggestion_type === 'next_action') {
    const { rows: [updated] } = await client.query(`
      UPDATE cases
      SET next_action = COALESCE($1, next_action),
          next_action_date = COALESCE($2, next_action_date),
          updated_at = NOW()
      WHERE id = $3
      RETURNING id
    `, [payload.next_action || null, payload.next_action_date || null, caseId]);
    return { table: 'cases', id: updated?.id || parseInt(caseId, 10) };
  }

  if (suggestion.suggestion_type === 'task') {
    const { rows: [task] } = await client.query(`
      INSERT INTO tareas
        (case_id, title, description, priority, due_date, assigned_to, created_by)
      VALUES ($1,$2,$3,$4,$5,(SELECT assigned_to FROM cases WHERE id = $1),$6)
      RETURNING id
    `, [
      caseId,
      payload.title || suggestion.title,
      payload.description || null,
      payload.priority || 'MEDIA',
      payload.due_date || null,
      userId,
    ]);
    return { table: 'tareas', id: task.id };
  }

  if (suggestion.suggestion_type === 'deadline') {
    const { rows: [deadline] } = await client.query(`
      INSERT INTO vencimientos
        (case_id, title, due_date, urgency, created_by)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id
    `, [
      caseId,
      payload.title || suggestion.title,
      payload.due_date,
      payload.urgency || 'MEDIO',
      userId,
    ]);
    return { table: 'vencimientos', id: deadline.id };
  }

  if (suggestion.suggestion_type === 'communication') {
    const { rows: [comm] } = await client.query(`
      INSERT INTO communications (case_id, type, content, metadata, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      caseId,
      payload.type || 'note',
      payload.content || suggestion.title,
      JSON.stringify({ source: 'sala', suggestion_id: suggestion.id }),
      userId,
    ]);
    return { table: 'communications', id: comm.id };
  }

  return null;
}

const applySuggestions = async (req, res) => {
  const caseId = req.params.caseId;
  const analysisId = req.params.analysisId;
  const { suggestion_ids } = req.body;

  if (!Array.isArray(suggestion_ids) || suggestion_ids.length === 0) {
    return res.status(400).json({ error: 'suggestion_ids es requerido' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: suggestions } = await client.query(`
      SELECT s.*
      FROM case_ai_suggestions s
      JOIN case_ai_analyses a ON a.id = s.analysis_id
      WHERE s.analysis_id = $1
        AND a.case_id = $2
        AND s.id = ANY($3::int[])
        AND s.status = 'pending'
      ORDER BY s.id
    `, [analysisId, caseId, suggestion_ids]);

    const applied = [];
    for (const suggestion of suggestions) {
      const result = await applySuggestion(client, { caseId, suggestion, userId: req.user.id });
      if (!result) continue;
      const { rows: [updatedSuggestion] } = await client.query(`
        UPDATE case_ai_suggestions
        SET status = 'applied',
            applied_by = $1,
            applied_at = NOW(),
            result_table = $2,
            result_id = $3
        WHERE id = $4
        RETURNING *
      `, [req.user.id, result.table, result.id, suggestion.id]);
      applied.push(updatedSuggestion);
    }

    if (applied.length) {
      await client.query(`
        UPDATE case_ai_analyses
        SET status = 'partially_applied',
            applied_at = COALESCE(applied_at, NOW())
        WHERE id = $1
      `, [analysisId]);

      await client.query(`
        INSERT INTO audit_log (table_name, record_id, action, changed_by, new_data)
        VALUES ('case_ai_analyses', $1, 'apply_suggestions', $2, $3)
      `, [analysisId, req.user.id, JSON.stringify({ suggestion_ids: applied.map(s => s.id) })]);
    }

    await client.query('COMMIT');
    res.json({ applied });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('applySuggestions:', err);
    res.status(500).json({ error: err.message || 'Error aplicando sugerencias' });
  } finally {
    client.release();
  }
};

module.exports = {
  getAnalyses,
  createAnalysis,
  applySuggestions,
};
