const db = require('../config/db');
const { buildCasesFilter, hasOperationalScope } = require('../middleware/authz');

const DEFAULT_COLUMNS = [
  { title: 'Por hacer', base_status: 'PENDIENTE', position: 0, color: '#6f7782' },
  { title: 'En curso', base_status: 'EN_CURSO', position: 1, color: '#4A9ED4' },
  { title: 'Revision', base_status: 'EN_CURSO', position: 2, color: '#8a7fd0' },
  { title: 'Hechas', base_status: 'COMPLETADA', position: 3, color: '#6EBA74' },
  { title: 'Canceladas', base_status: 'CANCELADA', position: 4, color: '#8f8f8f' },
];

const parseJsonInput = (value, fallback) => {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_err) {
      return fallback;
    }
  }
  return value;
};

const toInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
};

const parseCaseScope = (req) => {
  const raw = req.params.caseId ?? req.query.case_id;
  if (raw === undefined || raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const scopeConditionSql = (caseId, startIndex = 1) => {
  if (caseId) {
    return {
      sql: `case_id = $${startIndex}`,
      params: [caseId],
      next: startIndex + 1,
    };
  }

  return {
    sql: 'case_id IS NULL',
    params: [],
    next: startIndex,
  };
};

const ensureDefaultColumns = async ({ caseId, userId }) => {
  const scope = scopeConditionSql(caseId, 1);
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total FROM task_board_columns WHERE ${scope.sql}`,
    scope.params
  );

  if ((rows[0]?.total || 0) > 0) return;

  for (const col of DEFAULT_COLUMNS) {
    await db.query(
      `INSERT INTO task_board_columns (case_id, title, base_status, position, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [caseId || null, col.title, col.base_status, col.position, col.color, userId || null]
    );
  }
};

const resolveColumnAndStatus = async ({ boardColumnId, status, caseId, userId }) => {
  await ensureDefaultColumns({ caseId, userId });

  if (boardColumnId) {
    const parsedColumnId = toInt(boardColumnId);
    const query = caseId
      ? {
          sql: `SELECT id, base_status
                  FROM task_board_columns
                 WHERE id = $1
                   AND (case_id = $2 OR case_id IS NULL)
                 ORDER BY CASE WHEN case_id = $2 THEN 0 ELSE 1 END
                 LIMIT 1`,
          params: [parsedColumnId, caseId],
        }
      : {
          sql: `SELECT id, base_status
                  FROM task_board_columns
                 WHERE id = $1
                   AND case_id IS NULL
                 LIMIT 1`,
          params: [parsedColumnId],
        };

    const { rows } = await db.query(query.sql, query.params);

    if (!rows.length) {
      throw Object.assign(new Error('Columna de tablero no valida para esta tarea'), { status: 400 });
    }

    return {
      boardColumnId: rows[0].id,
      status: rows[0].base_status,
    };
  }

  if (status) {
    const byStatus = caseId
      ? await db.query(
          `SELECT id, base_status
             FROM task_board_columns
            WHERE base_status = $1
              AND (case_id = $2 OR case_id IS NULL)
            ORDER BY CASE WHEN case_id = $2 THEN 0 ELSE 1 END, position ASC, id ASC
            LIMIT 1`,
          [status, caseId]
        )
      : await db.query(
          `SELECT id, base_status
             FROM task_board_columns
            WHERE base_status = $1
              AND case_id IS NULL
            ORDER BY position ASC, id ASC
            LIMIT 1`,
          [status]
        );

    if (byStatus.rows.length) {
      return {
        boardColumnId: byStatus.rows[0].id,
        status: byStatus.rows[0].base_status,
      };
    }
  }

  const firstColumn = caseId
    ? await db.query(
        `SELECT id, base_status
           FROM task_board_columns
          WHERE case_id = $1 OR case_id IS NULL
          ORDER BY CASE WHEN case_id = $1 THEN 0 ELSE 1 END, position ASC, id ASC
          LIMIT 1`,
        [caseId]
      )
    : await db.query(
        `SELECT id, base_status
           FROM task_board_columns
          WHERE case_id IS NULL
          ORDER BY position ASC, id ASC
          LIMIT 1`
      );

  return {
    boardColumnId: firstColumn.rows[0]?.id || null,
    status: status || firstColumn.rows[0]?.base_status || 'PENDIENTE',
  };
};

const getTareaById = async (id) => {
  const { rows } = await db.query('SELECT * FROM tareas WHERE id = $1', [id]);
  return rows[0] || null;
};

const getTareas = async (req, res) => {
  const caseId = parseCaseScope(req);
  const {
    status,
    priority,
    assigned_to,
    overdue,
    board_column_id,
    macrocaso_id,
    limit = 120,
    offset = 0,
  } = req.query;

  try {
    await ensureDefaultColumns({ caseId, userId: req.user?.id });

    const where = ['1=1'];
    const params = [];
    let i = 1;

    if (caseId) {
      where.push(`t.case_id = $${i++}`);
      params.push(caseId);
    } else if (!hasOperationalScope(req.user?.role)) {
      // Bandeja global: solo tareas del usuario o de casos en su cartera.
      // Los roles con alcance operativo (admin/partner) ven todo, igual que
      // en el resto del sistema; restringir solo a los demás roles evita
      // además que buildCasesFilter devuelva un clause vacío ("AND )").
      const scope = buildCasesFilter(req.user.id, req.user.role, i + 2);
      where.push(`(
        t.assigned_to = $${i} OR t.created_by = $${i + 1}
        OR (t.case_id IS NOT NULL AND ${scope.clause})
      )`);
      params.push(req.user.id, req.user.id, ...scope.params);
      i = scope.next;
    }

    if (status) {
      where.push(`t.status = $${i++}`);
      params.push(status);
    }

    if (priority) {
      where.push(`t.priority = $${i++}`);
      params.push(priority);
    }

    if (assigned_to) {
      where.push(`t.assigned_to = $${i++}`);
      params.push(toInt(assigned_to));
    }

    if (board_column_id) {
      where.push(`t.board_column_id = $${i++}`);
      params.push(toInt(board_column_id));
    }

    if (macrocaso_id) {
      where.push(`t.macrocaso_id = $${i++}`);
      params.push(toInt(macrocaso_id));
    }

    if (overdue === 'true') {
      where.push(`t.due_date < CURRENT_DATE AND t.status NOT IN ('COMPLETADA','CANCELADA')`);
    }

    const pageLimit = Math.max(1, Math.min(toInt(limit, 120), 200));
    const pageOffset = Math.max(0, toInt(offset, 0));

    const [{ rows }, totalResult] = await Promise.all([
      db.query(
      `SELECT
        t.*,
        c.case_number,
        c.title AS case_title,
        u.name AS assigned_to_name,
        cr.name AS created_by_name,
        tbc.title AS board_column_title,
        tbc.base_status AS board_column_base_status,
        tbc.position AS board_column_position,
        (
          SELECT COUNT(*)::int
          FROM task_links tl
          WHERE tl.task_id = t.id
        ) AS links_count,
        (
          SELECT COUNT(*)::int
          FROM jsonb_array_elements(COALESCE(t.checklist, '[]'::jsonb)) citem
        ) AS checklist_total,
        (
          SELECT COUNT(*)::int
          FROM jsonb_array_elements(COALESCE(t.checklist, '[]'::jsonb)) citem
          WHERE COALESCE((citem->>'done')::boolean, FALSE) = TRUE
        ) AS checklist_done
      FROM tareas t
      LEFT JOIN cases c ON t.case_id = c.id
      LEFT JOIN users u ON t.assigned_to = u.id
      LEFT JOIN users cr ON t.created_by = cr.id
      LEFT JOIN task_board_columns tbc ON t.board_column_id = tbc.id
      WHERE ${where.join(' AND ')}
      ORDER BY
        COALESCE(tbc.position, 999) ASC,
        t.position ASC,
        CASE t.priority WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
        t.due_date ASC NULLS LAST,
        t.id ASC
      LIMIT $${i++}
      OFFSET $${i++}`,
      [...params, pageLimit, pageOffset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total
           FROM tareas t
           LEFT JOIN cases c ON t.case_id = c.id
          WHERE ${where.join(' AND ')}`,
        params
      ),
    ]);

    const total = totalResult.rows[0]?.total || 0;
    if (req.query.envelope === 'true') {
      return res.json({
        items: rows,
        total,
        returned: rows.length,
        limit: pageLimit,
        offset: pageOffset,
        has_more: pageOffset + rows.length < total,
      });
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Error obteniendo tareas' });
  }
};

const createTarea = async (req, res) => {
  const caseId = parseCaseScope(req);
  const {
    title,
    description,
    assigned_to,
    priority,
    due_date,
    status,
    board_column_id,
    actuacion_id,
    context,
    required_inputs,
    attachment_refs,
    checklist,
    blocked_reason,
    estimated_minutes,
    position,
  } = req.body;

  if (!title) return res.status(400).json({ error: 'El titulo es requerido' });

  try {
    if (caseId) {
      const exists = await db.query('SELECT id FROM cases WHERE id = $1 LIMIT 1', [caseId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    }

    const column = await resolveColumnAndStatus({
      boardColumnId: board_column_id,
      status: status || 'PENDIENTE',
      caseId,
      userId: req.user?.id,
    });

    const resolvedPosition = Number.isFinite(Number(position)) ? Number(position) : 0;

    const { rows } = await db.query(
      `INSERT INTO tareas (
        case_id, actuacion_id, title, description, assigned_to, priority, status, due_date,
        created_by, context, required_inputs, attachment_refs, checklist,
        blocked_reason, estimated_minutes, position, board_column_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11::jsonb, $12::jsonb, $13::jsonb,
        $14, $15, $16, $17
      )
      RETURNING *`,
      [
        caseId || null,
        actuacion_id || null,
        title,
        description || null,
        assigned_to || req.user.id,
        priority || 'MEDIA',
        column.status,
        due_date || null,
        req.user.id,
        context || null,
        JSON.stringify(parseJsonInput(required_inputs, [])),
        JSON.stringify(parseJsonInput(attachment_refs, [])),
        JSON.stringify(parseJsonInput(checklist, [])),
        blocked_reason || null,
        estimated_minutes || null,
        resolvedPosition,
        column.boardColumnId,
      ]
    );

    if (due_date && caseId) {
      const daysUntil = Math.ceil((new Date(due_date) - new Date()) / (1000 * 60 * 60 * 24));
      const urgency = daysUntil <= 1 ? 'CRITICO' : daysUntil <= 3 ? 'ALTO' : daysUntil <= 7 ? 'MEDIO' : 'BAJO';
      await db.query(
        `INSERT INTO vencimientos (case_id, tarea_id, title, due_date, urgency, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [caseId, rows[0].id, title, due_date, urgency, req.user.id]
      );
    }

    if (caseId) {
      await db.query(
        `INSERT INTO communications (case_id, type, content, created_by)
         VALUES ($1, 'system', $2, $3)`,
        [
          caseId,
          `Tarea creada: ${title}${due_date ? ' · vence ' + new Date(due_date).toLocaleDateString('es-CO') : ''}`,
          req.user.id,
        ]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Error creando tarea' });
  }
};

const updateTarea = async (req, res) => {
  const id = toInt(req.params.id);
  const {
    title,
    description,
    assigned_to,
    priority,
    status,
    due_date,
    board_column_id,
    context,
    checklist,
    blocked_reason,
    estimated_minutes,
    position,
    progress_percent,
  } = req.body;

  try {
    const prev = await getTareaById(id);
    if (!prev) return res.status(404).json({ error: 'Tarea no encontrada' });

    const scopeCaseId = prev.case_id || null;
    let nextStatus = status;
    let nextBoardColumnId = board_column_id === undefined ? prev.board_column_id : board_column_id;

    if (board_column_id !== undefined || status !== undefined) {
      const candidateColumnId = board_column_id !== undefined ? board_column_id : null;
      const resolved = await resolveColumnAndStatus({
        boardColumnId: candidateColumnId,
        status: status || prev.status,
        caseId: scopeCaseId,
        userId: req.user?.id,
      });
      nextStatus = resolved.status;
      nextBoardColumnId = resolved.boardColumnId;
    }

    const completing = nextStatus === 'COMPLETADA' && prev.status !== 'COMPLETADA';
    const completedAt = nextStatus === 'COMPLETADA'
      ? (prev.completed_at || new Date().toISOString())
      : null;

    // Si la tarea pasa a COMPLETADA, fuerza progress=100. Si vuelve a
    // PENDIENTE o nunca tuvo progreso, mantiene el actual o usa el body.
    const nextProgress = nextStatus === 'COMPLETADA'
      ? 100
      : (progress_percent !== undefined ? Math.max(0, Math.min(100, Number(progress_percent))) : prev.progress_percent);

    const { rows } = await db.query(
      `UPDATE tareas SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        assigned_to = COALESCE($3, assigned_to),
        priority = COALESCE($4, priority),
        status = COALESCE($5, status),
        due_date = COALESCE($6, due_date),
        completed_at = $7,
        context = COALESCE($8, context),
        checklist = COALESCE($9::jsonb, checklist),
        blocked_reason = COALESCE($10, blocked_reason),
        estimated_minutes = COALESCE($11, estimated_minutes),
        position = COALESCE($12, position),
        board_column_id = COALESCE($13, board_column_id),
        progress_percent = $15,
        updated_at = NOW()
      WHERE id = $14
      RETURNING *`,
      [
        title,
        description,
        assigned_to,
        priority,
        nextStatus,
        due_date,
        completedAt,
        context,
        checklist === undefined ? null : JSON.stringify(parseJsonInput(checklist, [])),
        blocked_reason,
        estimated_minutes,
        Number.isFinite(Number(position)) ? Number(position) : null,
        nextBoardColumnId,
        id,
        nextProgress,
      ]
    );

    if (completing) {
      await db.query(
        `UPDATE vencimientos
            SET resolved = TRUE, resolved_at = NOW()
          WHERE tarea_id = $1 AND resolved = FALSE`,
        [id]
      );

      if (prev.case_id) {
        await db.query(
          `INSERT INTO communications (case_id, type, content, created_by)
           VALUES ($1, 'system', $2, $3)`,
          [prev.case_id, `Tarea completada: ${rows[0].title}`, req.user.id]
        );
      }
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Error actualizando tarea' });
  }
};

const deleteTarea = async (req, res) => {
  const id = toInt(req.params.id);

  try {
    const task = await getTareaById(id);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

    await db.query('UPDATE vencimientos SET tarea_id = NULL WHERE tarea_id = $1', [id]);
    await db.query('DELETE FROM task_links WHERE task_id = $1', [id]);
    await db.query('DELETE FROM tareas WHERE id = $1', [id]);

    res.json({ message: 'Tarea eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando tarea' });
  }
};

const getTaskColumns = async (req, res) => {
  const caseId = parseCaseScope(req);

  try {
    await ensureDefaultColumns({ caseId, userId: req.user?.id });
    const scopeSql = caseId ? 'tbc.case_id = $1' : 'tbc.case_id IS NULL';
    const scopeParams = caseId ? [caseId] : [];

    const { rows } = await db.query(
      `SELECT tbc.*,
              COUNT(t.id)::int AS task_count
         FROM task_board_columns tbc
         LEFT JOIN tareas t ON t.board_column_id = tbc.id
        WHERE ${scopeSql}
        GROUP BY tbc.id
        ORDER BY tbc.position ASC, tbc.id ASC`,
      scopeParams
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo columnas del tablero' });
  }
};

const createTaskColumn = async (req, res) => {
  const caseId = parseCaseScope(req);
  const { title, base_status = 'PENDIENTE', color = null, position } = req.body || {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'El titulo de la columna es requerido' });
  }

  try {
    await ensureDefaultColumns({ caseId, userId: req.user?.id });
    const scope = scopeConditionSql(caseId, 1);

    const maxPos = await db.query(
      `SELECT COALESCE(MAX(position), -1) AS max_pos
         FROM task_board_columns
        WHERE ${scope.sql}`,
      scope.params
    );

    const resolvedPosition = Number.isFinite(Number(position))
      ? Number(position)
      : Number(maxPos.rows[0]?.max_pos || 0) + 1;

    const { rows } = await db.query(
      `INSERT INTO task_board_columns (case_id, title, base_status, position, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [caseId || null, String(title).trim(), base_status, resolvedPosition, color, req.user?.id || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando columna del tablero' });
  }
};

const updateTaskColumn = async (req, res) => {
  const caseId = parseCaseScope(req);
  const columnId = toInt(req.params.columnId);
  const { title, base_status, color, position } = req.body || {};

  try {
    const { rows: existing } = await db.query(
      `SELECT *
         FROM task_board_columns
        WHERE id = $1
          AND ((case_id IS NULL AND $2::int IS NULL) OR case_id = $2)
        LIMIT 1`,
      [columnId, caseId]
    );

    if (!existing.length) {
      return res.status(404).json({ error: 'Columna no encontrada' });
    }

    const prev = existing[0];

    const { rows } = await db.query(
      `UPDATE task_board_columns SET
        title = COALESCE($1, title),
        base_status = COALESCE($2, base_status),
        color = COALESCE($3, color),
        position = COALESCE($4, position),
        updated_at = NOW()
      WHERE id = $5
      RETURNING *`,
      [title ? String(title).trim() : null, base_status || null, color || null, toInt(position), columnId]
    );

    if (base_status && base_status !== prev.base_status) {
      await db.query(
        'UPDATE tareas SET status = $1, updated_at = NOW() WHERE board_column_id = $2',
        [base_status, columnId]
      );
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando columna' });
  }
};

const deleteTaskColumn = async (req, res) => {
  const caseId = parseCaseScope(req);
  const columnId = toInt(req.params.columnId);

  try {
    const { rows: existing } = await db.query(
      `SELECT *
         FROM task_board_columns
        WHERE id = $1
          AND ((case_id IS NULL AND $2::int IS NULL) OR case_id = $2)
        LIMIT 1`,
      [columnId, caseId]
    );

    if (!existing.length) return res.status(404).json({ error: 'Columna no encontrada' });

    const scope = scopeConditionSql(caseId, 1);
    const { rows: allColumns } = await db.query(
      `SELECT id, base_status
         FROM task_board_columns
        WHERE ${scope.sql}
        ORDER BY position ASC, id ASC`,
      scope.params
    );

    if (allColumns.length <= 1) {
      return res.status(400).json({ error: 'Debe existir al menos una columna en el tablero' });
    }

    const deleted = existing[0];
    const fallback = allColumns.find((col) => col.id !== columnId && col.base_status === deleted.base_status)
      || allColumns.find((col) => col.id !== columnId)
      || null;

    await db.query(
      `UPDATE tareas
          SET board_column_id = $1,
              status = COALESCE($2, status),
              updated_at = NOW()
        WHERE board_column_id = $3`,
      [fallback?.id || null, fallback?.base_status || null, columnId]
    );

    await db.query('DELETE FROM task_board_columns WHERE id = $1', [columnId]);
    res.json({ message: 'Columna eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando columna' });
  }
};

const getTaskLinks = async (req, res) => {
  const taskId = toInt(req.params.id);

  try {
    const task = await getTareaById(taskId);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

    const { rows } = await db.query(
      `SELECT tl.*,
              cdf.name AS drive_name,
              cdf.web_view_link AS drive_web_view_link,
              cdf.mime_type AS drive_mime_type,
              cm.content AS email_content,
              cm.metadata AS email_metadata,
              cm.created_at AS email_created_at
         FROM task_links tl
         LEFT JOIN case_drive_files cdf ON tl.drive_link_id = cdf.id
         LEFT JOIN communications cm ON tl.communication_id = cm.id
        WHERE tl.task_id = $1
        ORDER BY tl.created_at DESC, tl.id DESC`,
      [taskId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo vinculos de la tarea' });
  }
};

const getTaskLinkSources = async (req, res) => {
  const taskId = toInt(req.params.id);

  try {
    const task = await getTareaById(taskId);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

    if (!task.case_id) {
      return res.json({ drive_files: [], emails: [] });
    }

    const [drive, emails] = await Promise.all([
      db.query(
        `SELECT id, drive_file_id, name, mime_type, web_view_link, category, modified_time
           FROM case_drive_files
          WHERE case_id = $1
          ORDER BY modified_time DESC NULLS LAST, created_at DESC`,
        [task.case_id]
      ),
      db.query(
        `SELECT id, content, metadata, created_at
           FROM communications
          WHERE case_id = $1
            AND type = 'email'
          ORDER BY created_at DESC
          LIMIT 120`,
        [task.case_id]
      ),
    ]);

    res.json({
      drive_files: drive.rows,
      emails: emails.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo fuentes para adjuntar' });
  }
};

const linkDriveToTask = async (req, res) => {
  const taskId = toInt(req.params.id);
  const { drive_link_id: driveLinkId, role = 'attachment' } = req.body || {};

  if (!driveLinkId) return res.status(400).json({ error: 'drive_link_id es requerido' });

  try {
    const task = await getTareaById(taskId);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!task.case_id) return res.status(400).json({ error: 'La tarea debe pertenecer a un caso para adjuntar archivos de Drive' });

    const { rows: files } = await db.query(
      `SELECT *
         FROM case_drive_files
        WHERE id = $1
          AND case_id = $2
        LIMIT 1`,
      [toInt(driveLinkId), task.case_id]
    );

    if (!files.length) return res.status(404).json({ error: 'Archivo de Drive no encontrado para este caso' });

    const file = files[0];

    const existing = await db.query(
      `SELECT id
         FROM task_links
        WHERE task_id = $1
          AND drive_link_id = $2
          AND role = $3
        LIMIT 1`,
      [taskId, file.id, role]
    );

    if (existing.rows.length) {
      return res.json({ id: existing.rows[0].id, duplicated: true });
    }

    const { rows } = await db.query(
      `INSERT INTO task_links (task_id, case_id, kind, role, drive_link_id, label, metadata, created_by)
       VALUES ($1, $2, 'drive', $3, $4, $5, $6::jsonb, $7)
       RETURNING *`,
      [
        taskId,
        task.case_id,
        role,
        file.id,
        file.name,
        JSON.stringify({
          category: file.category,
          drive_file_id: file.drive_file_id,
          mime_type: file.mime_type,
          web_view_link: file.web_view_link,
        }),
        req.user?.id || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error vinculando archivo Drive a la tarea' });
  }
};

const linkEmailToTask = async (req, res) => {
  const taskId = toInt(req.params.id);
  const { communication_id: communicationId, role = 'evidence' } = req.body || {};

  if (!communicationId) return res.status(400).json({ error: 'communication_id es requerido' });

  try {
    const task = await getTareaById(taskId);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!task.case_id) return res.status(400).json({ error: 'La tarea debe pertenecer a un caso para vincular correos' });

    const { rows: comms } = await db.query(
      `SELECT id, content, metadata, created_at
         FROM communications
        WHERE id = $1
          AND case_id = $2
          AND type = 'email'
        LIMIT 1`,
      [toInt(communicationId), task.case_id]
    );

    if (!comms.length) return res.status(404).json({ error: 'Correo no encontrado en el expediente del caso' });

    const comm = comms[0];
    const metadata = parseJsonInput(comm.metadata, {}) || {};
    const subject = metadata.subject || String(comm.content || '').split('\n')[0] || `Correo #${comm.id}`;

    const existing = await db.query(
      `SELECT id
         FROM task_links
        WHERE task_id = $1
          AND communication_id = $2
          AND role = $3
        LIMIT 1`,
      [taskId, comm.id, role]
    );

    if (existing.rows.length) {
      return res.json({ id: existing.rows[0].id, duplicated: true });
    }

    const { rows } = await db.query(
      `INSERT INTO task_links (task_id, case_id, kind, role, communication_id, label, metadata, created_by)
       VALUES ($1, $2, 'email', $3, $4, $5, $6::jsonb, $7)
       RETURNING *`,
      [
        taskId,
        task.case_id,
        role,
        comm.id,
        subject,
        JSON.stringify({
          subject,
          created_at: comm.created_at,
          metadata,
        }),
        req.user?.id || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error vinculando correo a la tarea' });
  }
};

const unlinkTaskLink = async (req, res) => {
  const taskId = toInt(req.params.id);
  const linkId = toInt(req.params.linkId);

  try {
    const { rows } = await db.query(
      `DELETE FROM task_links
        WHERE id = $1
          AND task_id = $2
      RETURNING *`,
      [linkId, taskId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Vinculo no encontrado' });
    res.json({ message: 'Vinculo eliminado', link: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando vinculo de la tarea' });
  }
};

module.exports = {
  getTareas,
  createTarea,
  updateTarea,
  deleteTarea,
  getTaskColumns,
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
  getTaskLinks,
  getTaskLinkSources,
  linkDriveToTask,
  linkEmailToTask,
  unlinkTaskLink,
};


