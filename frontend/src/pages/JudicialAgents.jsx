import { useMemo, useState } from 'react';

const CATEGORIES = [
  { key: 'all', label: 'Todo' },
  { key: 'public', label: 'Publico' },
  { key: 'adapter', label: 'Adapter' },
];

const PLATFORMS = [
  {
    key: 'cpnu',
    label: 'Consulta Nacional',
    short: 'CN',
    category: 'public',
    categoryLabel: 'Consulta publica',
    tagline: 'Case tracking publico',
    description: 'Contrato para consultar estados y actuaciones publicas, normalizarlas y vincularlas al expediente Opus.',
    status: 'Stub publico',
    maturity: 'Extension point',
    security: 'Sin credencial',
    score: 'Read-only',
    actions: ['Consultar estado', 'Normalizar timeline', 'Vincular expediente'],
    tools: [
      ['judicial_case_tracking_lookup', 'Consulta de solo lectura mediante adapter propio del operador.'],
      ['judicial_case_tracking_link', 'Relaciona un resultado externo con un expediente Opus.'],
      ['judicial_case_tracking_sync', 'Sincroniza actuaciones publicas ya normalizadas.'],
    ],
    accent: 'blue',
  },
  {
    key: 'tyba',
    label: 'Justicia XXI / TYBA',
    short: 'TY',
    category: 'adapter',
    categoryLabel: 'Gestion judicial',
    tagline: 'Lectura primero',
    description: 'Slot para adapters de seguimiento de procesos heredados. No incluye radicacion ni automatizacion de navegador.',
    status: 'Por implementar',
    maturity: 'Adapter externo',
    security: 'Operador responsable',
    score: 'Read-only',
    actions: ['Consultar proceso', 'Leer estados', 'Registrar evidencia'],
    tools: [
      ['tyba_status_lookup', 'Adapter sugerido para lectura y normalizacion.'],
      ['tyba_timeline_parser', 'Transforma estados en eventos internos.'],
      ['case_tracking_audit', 'Guarda evidencia de consulta y fuente.'],
    ],
    accent: 'gold',
  },
  {
    key: 'samai_public',
    label: 'SAMAI Publico',
    short: 'SA',
    category: 'adapter',
    categoryLabel: 'Contencioso administrativo',
    tagline: 'Seguimiento publico',
    description: 'Slot para seguimiento y consulta publica cuando la fuente lo permita. Las actuaciones autenticadas quedan fuera del release publico.',
    status: 'Por implementar',
    maturity: 'Adapter externo',
    security: 'Solo lectura',
    score: 'Read-only',
    actions: ['Consultar proceso', 'Actualizar timeline', 'Guardar fuente'],
    tools: [
      ['samai_public_lookup', 'Busca informacion publica disponible.'],
      ['samai_timeline_sync', 'Normaliza movimientos y estados.'],
      ['case_tracking_source_record', 'Registra URL, fecha y evidencia.'],
    ],
    accent: 'green',
  },
];

const MCP_TOOLS = [
  { name: 'judicial_case_tracking_platforms', category: 'public', platformKey: 'cpnu', copy: 'Lista slots de adapters de seguimiento judicial.' },
  { name: 'judicial_case_tracking_lookup', category: 'public', platformKey: 'cpnu', copy: 'Contrato para consulta publica de estado procesal.' },
  { name: 'judicial_case_tracking_link', category: 'public', platformKey: 'cpnu', copy: 'Relaciona un radicado externo con un expediente Opus.' },
];

export default function JudicialAgents() {
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [activePlatform, setActivePlatform] = useState(PLATFORMS[0].key);

  const filteredCards = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return PLATFORMS.filter((platform) => {
      const matchesCategory = activeCategory === 'all' || platform.category === activeCategory;
      const haystack = `${platform.label} ${platform.tagline} ${platform.description} ${platform.actions.join(' ')}`.toLowerCase();
      return matchesCategory && (!term || haystack.includes(term));
    });
  }, [activeCategory, searchTerm]);

  const activeCard = PLATFORMS.find((platform) => platform.key === activePlatform) || PLATFORMS[0];
  const filteredTools = MCP_TOOLS.filter((tool) => {
    const term = searchTerm.trim().toLowerCase();
    const matchesCategory = activeCategory === 'all' || tool.category === activeCategory;
    const haystack = `${tool.name} ${tool.copy}`.toLowerCase();
    return matchesCategory && (!term || haystack.includes(term));
  });

  return (
    <>
      <div className="page-header judicial-header">
        <div>
          <div className="page-title">Tracking Judicial</div>
          <div className="page-subtitle">Contratos MCP y slots de adapters para seguimiento de procesos de solo lectura.</div>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => document.getElementById('judicial-tracking-contract')?.scrollIntoView({ behavior: 'smooth' })}>
          Ver contrato
        </button>
      </div>

      <div className="page-body judicial-agents-page">
        <section className="judicial-hero judicial-hero--app-store">
          <div className="judicial-matrix" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="judicial-hero-copy">
            <span className="judicial-kicker">Case tracking publico</span>
            <h1>Adapters judiciales de lectura, no de radicacion</h1>
            <p>
              Este release deja abierta la frontera correcta: consultar, normalizar y auditar informacion publica del proceso.
              La radicacion, el uso delegado de credenciales y la automatizacion de portales no hacen parte del codigo publico.
            </p>
            <div className="judicial-hero-actions">
              <button className="btn btn-primary" type="button" onClick={() => document.getElementById('judicial-systems-store')?.scrollIntoView({ behavior: 'smooth' })}>Explorar adapters</button>
              <button className="btn btn-secondary" type="button" onClick={() => document.getElementById('judicial-boundary')?.scrollIntoView({ behavior: 'smooth' })}>Ver frontera</button>
            </div>
          </div>
          <div className="judicial-hero-store-card" aria-hidden="true">
            <div className="judicial-store-icon judicial-store-icon--blue judicial-store-icon--xl">MCP</div>
            <span>Public self-hosted</span>
            <strong>Case Tracking</strong>
            <p>Lectura publica, normalizacion de timeline y trazabilidad.</p>
          </div>
        </section>

        <section id="judicial-systems-store" className="judicial-store judicial-store--market">
          <div className="judicial-store-head">
            <div>
              <span>Adapter slots</span>
              <h2>Seguimiento judicial</h2>
              <p>Cada slot describe una integracion de lectura que el self-hoster puede implementar bajo su responsabilidad.</p>
            </div>
            <strong>{PLATFORMS.length} slots</strong>
          </div>

          <div className="judicial-store-toolbar">
            <label>
              <span>Buscar</span>
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="CPNU, TYBA, SAMAI..." />
            </label>
            <div className="judicial-store-tabs" aria-label="Categorias de tracking judicial">
              {CATEGORIES.map(category => (
                <button
                  key={category.key}
                  type="button"
                  className={activeCategory === category.key ? 'active' : ''}
                  onClick={() => setActiveCategory(category.key)}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>

          <div className="judicial-system-grid judicial-system-grid--store">
            {filteredCards.map(platform => (
              <button
                key={platform.key}
                type="button"
                className={`judicial-system-card judicial-system-card--${platform.accent}${activePlatform === platform.key ? ' active' : ''}`}
                onClick={() => setActivePlatform(platform.key)}
              >
                <div className="judicial-store-card-head">
                  <div className={`judicial-store-icon judicial-store-icon--${platform.accent}`}>{platform.short}</div>
                  <div className="judicial-system-top">
                    <span>{platform.label}</span>
                    <em>{platform.status}</em>
                  </div>
                </div>
                <strong>{platform.tagline}</strong>
                <p>{platform.description}</p>
                <div className="judicial-store-meta">
                  <span>{platform.score}</span>
                  <span>{platform.maturity}</span>
                  <span>{platform.tools.length} tools</span>
                </div>
                <div className="judicial-app-actions">
                  {platform.actions.map(action => <small key={action}>{action}</small>)}
                </div>
                <div className="judicial-open-row">
                  <b>{platform.security}</b>
                  <i>Ver contrato</i>
                </div>
              </button>
            ))}
          </div>
          {filteredCards.length === 0 && <div className="judicial-empty">No encontre adapters para ese filtro.</div>}
        </section>

        <section id="judicial-tracking-contract" className="judicial-tool-detail-shell">
          <div className="judicial-tool-detail-hero">
            <div className={`judicial-store-icon judicial-store-icon--${activeCard.accent} judicial-store-icon--xl`}>
              {activeCard.short}
            </div>
            <div className="judicial-tool-identity">
              <span>{activeCard.categoryLabel}</span>
              <h2>{activeCard.label}</h2>
              <p>{activeCard.description}</p>
              <div className="judicial-tool-tags">
                <small>{activeCard.maturity}</small>
                <small>{activeCard.security}</small>
                <small>Sin efectos juridicos externos</small>
              </div>
            </div>
          </div>

          <div className="judicial-tool-console">
            <section className="judicial-tool-panel judicial-tool-panel--wide">
              <div className="judicial-panel-head">
                <div>
                  <span>Capacidades MCP</span>
                  <h2>Contrato de lectura</h2>
                </div>
                <strong>{activeCard.tools.length} tools</strong>
              </div>
              <div className="judicial-mcp-list">
                {activeCard.tools.map(([name, copy]) => (
                  <div key={name} className="judicial-mcp-row">
                    <span>{name}</span>
                    <p>{copy}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="judicial-boundary" className="judicial-tool-panel judicial-tool-panel--wide">
              <div className="judicial-panel-head">
                <div>
                  <span>Frontera publica</span>
                  <h2>Que no se incluye</h2>
                </div>
                <strong>Open-core</strong>
              </div>
              <div className="judicial-mcp-list">
                <div className="judicial-mcp-row">
                  <span>Sin radicacion</span>
                  <p>No se publican flujos para presentar demandas, memoriales, PQRS o actos con efectos juridicos externos.</p>
                </div>
                <div className="judicial-mcp-row">
                  <span>Sin credenciales delegadas</span>
                  <p>No se publica vault judicial, sesiones de navegador, OTP/MFA ni automatizacion de portales autenticados.</p>
                </div>
                <div className="judicial-mcp-row">
                  <span>Solo lectura auditable</span>
                  <p>Las contribuciones publicas deben limitarse a case tracking, normalizacion de datos publicos y trazabilidad.</p>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="judicial-mcp-store-section">
          <div className="judicial-mcp-store-head">
            <span>Toolchain publico</span>
            <strong>{filteredTools.length} MCP tools</strong>
          </div>
          <div className="judicial-mcp-store-grid">
            {filteredTools.map(tool => (
              <button key={tool.name} type="button" onClick={() => setActivePlatform(tool.platformKey)}>
                <span>{tool.name}</span>
                <p>{tool.copy}</p>
                <em>Solo lectura</em>
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
