import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import CapabilityStatus from '../components/CapabilityStatus';
import api from '../services/api';

const PORTALS = [
  {
    name: 'CPNU / SIUGJ',
    priority: 'P0',
    status: 'manual_asistido',
    value: 'Consulta y seguimiento general de procesos',
    source: 'Rama Judicial',
    next: 'Mapear campos, terminos de uso y bloqueos anti-bot antes de conector.',
  },
  {
    name: 'TYBA / Justicia XXI Web',
    priority: 'P0',
    status: 'por_conectar',
    value: 'Consulta de procesos judiciales',
    source: 'Rama Judicial',
    next: 'Investigar flujo publico, captcha y evidencia descargable.',
  },
  {
    name: 'SAMAI',
    priority: 'P0',
    status: 'manual_asistido',
    value: 'Contencioso administrativo y Consejo de Estado',
    source: 'Consejo de Estado',
    next: 'Crear guia manual asistida y contrato de datos esperado.',
  },
  {
    name: 'Publicaciones Procesales',
    priority: 'P1',
    status: 'por_conectar',
    value: 'Estados, traslados y publicaciones',
    source: 'Rama Judicial',
    next: 'Definir vigilancia por fuente oficial y rastro de captura.',
  },
  {
    name: 'Fiscalia / SPOA / NUNC',
    priority: 'P1',
    status: 'bloqueado',
    value: 'Seguimiento penal y denuncias',
    source: 'Fiscalia',
    next: 'Validar restricciones, credenciales y viabilidad juridica.',
  },
  {
    name: 'SECOP I / II',
    priority: 'P1',
    status: 'prototipo',
    value: 'Contratacion estatal y due diligence',
    source: 'Colombia Compra Eficiente',
    next: 'Explorar API/datos abiertos y convertir senales en planes.',
  },
  {
    name: 'SIRNA',
    priority: 'P2',
    status: 'por_conectar',
    value: 'Validacion de abogados y tarjeta profesional',
    source: 'Rama Judicial',
    next: 'Preparar consulta utilitaria con registro de fuente.',
  },
  {
    name: 'SUIN-Juriscol',
    priority: 'P1',
    status: 'por_conectar',
    value: 'Normativa y jurisprudencia oficial',
    source: 'Estado colombiano',
    next: 'Conectar como fuente para Biblioteca y criterios internos.',
  },
  {
    name: 'Cortes y relatorias',
    priority: 'P1',
    status: 'por_conectar',
    value: 'Jurisprudencia constitucional, civil, penal y administrativa',
    source: 'Altas cortes',
    next: 'Separar busqueda, evidencia y resumen con citas.',
  },
  {
    name: 'RUES / Camaras de Comercio',
    priority: 'P2',
    status: 'manual_asistido',
    value: 'Existencia, representacion y personas juridicas',
    source: 'Confecamaras',
    next: 'Definir modo asistido para due diligence sin automatizar pagos.',
  },
  {
    name: 'DIAN / RUT',
    priority: 'P2',
    status: 'bloqueado',
    value: 'Datos fiscales y responsabilidades',
    source: 'DIAN',
    next: 'Requiere decision de credenciales, seguridad y autorizacion.',
  },
  {
    name: 'VUR / Supernotariado',
    priority: 'P2',
    status: 'manual_asistido',
    value: 'Inmuebles y registros publicos',
    source: 'Supernotariado',
    next: 'Crear checklist de consulta y evidencia para asuntos inmobiliarios.',
  },
  {
    name: 'Superintendencias y MinTrabajo',
    priority: 'P1-P2',
    status: 'por_conectar',
    value: 'PQRS, tramites y vigilancia administrativa',
    source: 'SIC, Supersalud, Supersociedades, MinTrabajo',
    next: 'Priorizar por linea de servicio y frecuencia real de uso.',
  },
];

const SIGNALS = [
  ['Contexto', 'El radar sabe que portales y fuentes importan para cada linea juridica.'],
  ['Lectura', 'Cada fuente debe producir evidencia, cambio detectado y ruta sugerida.'],
  ['Riesgo', 'No automatizar portales con captcha, credenciales o terminos inciertos.'],
  ['Accion', 'Usar modo manual asistido mientras el conector seguro no exista.'],
  ['Rastro', 'Guardar fuente, fecha, evidencia y abogado responsable.'],
];

function PortalCard({ portal }) {
  return (
    <article className="ops-card radar-portal-card">
      <div className="ops-card-head">
        <div>
          <div className="ops-kicker">{portal.priority} · {portal.source}</div>
          <h3>{portal.name}</h3>
        </div>
        <CapabilityStatus status={portal.status} />
      </div>
      <p>{portal.value}</p>
      <div className="ops-next-step">
        <span>Accion sugerida</span>
        <strong>{portal.next}</strong>
      </div>
    </article>
  );
}

export default function RadarColombia() {
  const p0Count = PORTALS.filter(portal => portal.priority === 'P0').length;
  const blockedCount = PORTALS.filter(portal => portal.status === 'bloqueado').length;
  const manualCount = PORTALS.filter(portal => portal.status === 'manual_asistido').length;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Radar Colombia</div>
          <div className="page-subtitle">Portales juridicos, fuentes oficiales y modo manual asistido como ventaja local.</div>
        </div>
      </div>

      <div className="page-body">
        <section className="ops-hero">
          <div>
            <div className="ops-label">Radar local</div>
            <h2>La firma observa Colombia antes de actuar.</h2>
            <p>
              Este mapa no finge conectores completos. Muestra donde Opus puede consultar,
              vigilar, pedir ayuda humana y conservar evidencia para reaccionar con criterio.
            </p>
          </div>
          <div className="ops-hero-metrics">
            <div><span>Fuentes</span><strong>{PORTALS.length}</strong></div>
            <div><span>Prioridad P0</span><strong>{p0Count}</strong></div>
            <div><span>Manual asistido</span><strong>{manualCount}</strong></div>
            <div><span>Bloqueos</span><strong>{blockedCount}</strong></div>
          </div>
        </section>

        <section className="ops-lens-grid">
          {SIGNALS.map(([title, body]) => (
            <div className="ops-lens" key={title}>
              <span>{title}</span>
              <p>{body}</p>
            </div>
          ))}
        </section>

        <CpnuConnectorSection />

        <section className="ops-section">
          <div className="ops-section-head">
            <div>
              <span>Mapa de portales</span>
              <h3>Fuentes oficiales y estado de capacidad</h3>
            </div>
            <CapabilityStatus status="prototipo" />
          </div>
          <div className="ops-card-grid three">
            {PORTALS.map(portal => <PortalCard key={portal.name} portal={portal} />)}
          </div>
        </section>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// CPNU connector — fuente pública Rama Judicial (lectura)
// ─────────────────────────────────────────────────────────────

function CpnuConnectorSection() {
  const navigate = useNavigate();
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(null);
  const [lookupValue, setLookupValue] = useState('');
  const [lookupResults, setLookupResults] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [linkingCase, setLinkingCase] = useState(null);
  const [caseChoices, setCaseChoices] = useState([]);
  const [caseSearch, setCaseSearch] = useState('');
  const [casesLoading, setCasesLoading] = useState(false);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/judicial/cpnu/links');
      setLinks(res.data?.links || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  const doLookup = async () => {
    setLookupLoading(true);
    setLookupResults(null);
    setNotice('');
    try {
      const res = await api.get('/judicial/cpnu/lookup', {
        params: { radicado: lookupValue },
        timeout: 30000,
      });
      setLookupResults(res.data);
    } catch (err) {
      setNotice(err.response?.data?.error || err.message || 'Error al consultar CPNU');
    } finally {
      setLookupLoading(false);
    }
  };

  const openLinkDialog = (proceso) => {
    setLinkingCase(proceso);
    setCaseSearch('');
    setCaseChoices([]);
  };

  const searchCases = async (term) => {
    setCasesLoading(true);
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (term.trim()) params.set('search', term.trim());
      const res = await api.get(`/cases?${params}`);
      setCaseChoices(res.data?.cases || []);
    } catch {
      setCaseChoices([]);
    } finally {
      setCasesLoading(false);
    }
  };

  const linkToCase = async (caseId) => {
    try {
      await api.post('/judicial/cpnu/link', {
        case_id: caseId,
        idProceso: linkingCase.idProceso,
      }, { timeout: 30000 });
      setNotice('Caso vinculado y actuaciones sincronizadas.');
      setLinkingCase(null);
      setLookupResults(null);
      setLookupValue('');
      await loadLinks();
    } catch (err) {
      setNotice(err.response?.data?.error || 'No se pudo vincular el caso.');
    }
  };

  // Crear caso nuevo directamente desde un proceso CPNU.
  // Trae el despacho, departamento, sujetos procesales y todas las
  // actuaciones de un golpe — el abogado solo confirma la materia.
  const createCaseFromProceso = async (proceso, serviceType) => {
    try {
      const res = await api.post('/judicial/cpnu/create-case', {
        radicado: lookupValue,
        idProceso: proceso.idProceso,
        service_type: serviceType || 'OTRO',
      }, { timeout: 45000 });
      const c = res.data?.case;
      setNotice(`Caso ${c?.case_number || `#${c?.id}`} creado con ${res.data?.partes_created || 0} parte(s) y ${res.data?.actuaciones || 0} actuación(es) cargadas.`);
      setLookupResults(null);
      setLookupValue('');
      await loadLinks();
      if (c?.id) navigate(`/cases/${c.id}`);
    } catch (err) {
      setNotice(err.response?.data?.error || 'No se pudo crear el caso desde CPNU.');
    }
  };

  const syncOne = async (linkId) => {
    setSyncing(linkId);
    try {
      const res = await api.post(`/judicial/cpnu/links/${linkId}/sync`, {}, { timeout: 30000 });
      setNotice(`Sync OK · ${res.data?.newActuaciones ?? 0} nuevas de ${res.data?.totalActuaciones ?? 0}.`);
      await loadLinks();
    } catch (err) {
      setNotice(err.response?.data?.error || 'Error al sincronizar.');
    } finally {
      setSyncing(null);
    }
  };

  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <div>
          <span>CPNU · Consulta de Procesos</span>
          <h3>Radicados vinculados a casos de la firma</h3>
        </div>
        <CapabilityStatus status="prototipo" />
      </div>

      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={lookupValue}
            onChange={(e) => setLookupValue(e.target.value)}
            placeholder="Número de radicado (23 dígitos)"
            style={{ flex: 1, minWidth: 240 }}
            onKeyDown={(e) => e.key === 'Enter' && doLookup()}
          />
          <button className="btn btn-primary btn-sm" onClick={doLookup} disabled={lookupLoading || !lookupValue}>
            {lookupLoading ? 'Consultando…' : 'Consultar CPNU'}
          </button>
        </div>
        {notice && <div style={{ marginTop: 'var(--sp-2)', fontSize: 13, color: 'var(--gold)' }}>{notice}</div>}

        {lookupResults && (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{lookupResults.procesos.length} proceso(s) encontrado(s)</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
              {lookupResults.procesos.map((p) => (
                <ProcessResultCard
                  key={p.idProceso}
                  proceso={p}
                  onLinkExisting={() => openLinkDialog(p)}
                  onCreateNew={(st) => createCaseFromProceso(p, st)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)' }}>Cargando enlaces…</div>
      ) : links.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Aún no hay casos vinculados a CPNU. Usa el buscador arriba.</div>
      ) : (
        <div className="ops-card-grid three">
          {links.map((l) => (
            <CpnuLinkCard
              key={l.id}
              link={l}
              syncing={syncing === l.id}
              onSync={() => syncOne(l.id)}
              onOpenCase={() => navigate(`/cases/${l.case_id}`)}
            />
          ))}
        </div>
      )}

      {linkingCase && (
        <CpnuLinkModal
          proceso={linkingCase}
          caseSearch={caseSearch}
          onSearchChange={setCaseSearch}
          onSearch={() => searchCases(caseSearch)}
          choices={caseChoices}
          loading={casesLoading}
          onPick={linkToCase}
          onClose={() => setLinkingCase(null)}
        />
      )}
    </section>
  );
}

// Resultado de búsqueda CPNU: muestra TODA la info del proceso del API
// (despacho, departamento, sujetos procesales, fechas) + acciones para
// vincular a caso existente o crear uno nuevo eligiendo la materia.
function ProcessResultCard({ proceso, onLinkExisting, onCreateNew }) {
  const [expanded, setExpanded] = useState(false);
  const [serviceType, setServiceType] = useState('OTRO');
  const [creating, setCreating] = useState(false);

  const sujetos = proceso.sujetosProcesales || '';
  const partes = sujetos.split(/\s*[|;\/\n]\s*/).map((s) => s.trim()).filter(Boolean);

  const SERVICE_OPTIONS = [
    { v: 'TUTELA',      l: 'Tutela' },
    { v: 'CONTRATO',    l: 'Contrato' },
    { v: 'LABORAL',     l: 'Laboral' },
    { v: 'PENAL',       l: 'Penal' },
    { v: 'SOCIETARIO',  l: 'Societario' },
    { v: 'REGULATORIO', l: 'Regulatorio' },
    { v: 'PQRS',        l: 'PQRS' },
    { v: 'OTRO',        l: 'Otro' },
  ];

  return (
    <div style={{
      background: 'var(--bg-3)',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--gold)',
      borderRadius: 'var(--radius)',
      padding: 'var(--sp-3)',
    }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
        {proceso.despacho || 'Despacho sin dato'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <span>{proceso.departamento || '—'}</span>
        <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
        <span>idProceso {proceso.idProceso}</span>
        {proceso.fechaProceso && (
          <>
            <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
            <span>inició {new Date(proceso.fechaProceso).toLocaleDateString('es-CO')}</span>
          </>
        )}
        {proceso.fechaUltimaActuacion && (
          <>
            <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
            <span style={{ color: 'var(--gold)' }}>última actuación {new Date(proceso.fechaUltimaActuacion).toLocaleDateString('es-CO')}</span>
          </>
        )}
      </div>

      {partes.length > 0 && (
        <div style={{ marginBottom: 'var(--sp-2)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Sujetos procesales ({partes.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {partes.map((p, i) => (
              <span key={i} style={{
                fontSize: 11,
                padding: '2px 8px',
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                color: 'var(--text-primary)',
              }}>
                {p.length > 60 ? p.slice(0, 60) + '…' : p}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{
        display: 'flex', gap: 'var(--sp-2)',
        alignItems: 'center', flexWrap: 'wrap',
        marginTop: 'var(--sp-2)',
        paddingTop: 'var(--sp-2)',
        borderTop: '1px solid var(--border)',
      }}>
        {!expanded ? (
          <>
            <button className="btn btn-secondary btn-sm" onClick={onLinkExisting}>
              Vincular a caso existente
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setExpanded(true)}>
              + Crear caso nuevo
            </button>
          </>
        ) : (
          <>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Materia:&nbsp;
              <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                {SERVICE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </label>
            <button
              className="btn btn-primary btn-sm"
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                try { await onCreateNew(serviceType); } finally { setCreating(false); }
              }}
            >
              {creating ? 'Creando…' : 'Crear caso con esta info'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(false)}>Cancelar</button>
          </>
        )}
      </div>
    </div>
  );
}

function CpnuLinkCard({ link, syncing, onSync, onOpenCase }) {
  const newCount = Number(link.new_count || 0);
  const meta = link.metadata?.cpnu || {};
  const lastSync = link.last_sync_at ? new Date(link.last_sync_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Sin sincronizar';

  return (
    <article className="ops-card radar-portal-card" style={{ borderLeft: newCount > 0 ? '4px solid var(--gold)' : undefined }}>
      <div className="ops-card-head">
        <div>
          <div className="ops-kicker">{link.case_number || `Caso ${link.case_id}`}</div>
          <h3 style={{ fontSize: 15 }}>{link.case_title || 'Sin título'}</h3>
        </div>
        {newCount > 0 && (
          <span style={{
            background: 'var(--gold)', color: 'var(--black)', borderRadius: 12,
            padding: '2px 10px', fontSize: 11, fontWeight: 700,
          }}>
            {newCount} nueva{newCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        <strong style={{ color: 'var(--text-primary)' }}>Despacho:</strong> {meta.despacho || '—'}<br />
        <strong style={{ color: 'var(--text-primary)' }}>Radicado:</strong> {link.external_process_number || '—'}<br />
        <strong style={{ color: 'var(--text-primary)' }}>Último sync:</strong> {lastSync}
      </p>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
        <button className="btn btn-primary btn-sm" onClick={onSync} disabled={syncing}>
          {syncing ? 'Sincronizando…' : 'Refrescar'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onOpenCase}>
          Ver caso
        </button>
      </div>
    </article>
  );
}

function CpnuLinkModal({ proceso, caseSearch, onSearchChange, onSearch, choices, loading, onPick, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Vincular proceso CPNU a caso interno</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{proceso.despacho}</div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
            <input
              value={caseSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar caso por número o título"
              style={{ flex: 1 }}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            />
            <button className="btn btn-secondary btn-sm" onClick={onSearch}>Buscar</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {loading && <div style={{ color: 'var(--text-secondary)' }}>Cargando…</div>}
            {!loading && choices.length === 0 && (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Busca un caso para vincular.</div>
            )}
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                style={{
                  textAlign: 'left', padding: 'var(--sp-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--bg-3)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600 }}>{c.case_number || `Caso ${c.id}`}</div>
                <div style={{ fontSize: 13 }}>{c.title}</div>
                {c.client_name && <small style={{ color: 'var(--text-secondary)' }}>{c.client_name}</small>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
