import CapabilityStatus from '../components/CapabilityStatus';

const GROUPS = [
  {
    title: 'Aliados tecnologicos',
    posture: 'Integrar',
    status: 'por_conectar',
    items: ['OpenAI', 'Anthropic', 'Google Workspace', 'Microsoft', 'workflow', 'Zapier', 'Workato', 'UiPath'],
    read: 'Modelos, agentes, MCP, conectores, automatizacion y gobierno enterprise.',
  },
  {
    title: 'Competidores percibidos',
    posture: 'Diferenciar',
    status: 'prototipo',
    items: ['Lemontech', 'Litigando', 'Lupa Juridica', 'RuleX', 'JuridAI', 'LexID', 'Veridic', 'Tirant'],
    read: 'Gestion legal, vigilancia procesal, IA juridica y datos colombianos.',
  },
  {
    title: 'Benchmarks globales',
    posture: 'Adaptar patrones',
    status: 'manual_asistido',
    items: ['Clio', 'Filevine', 'Legora', 'Harvey', 'CoCounsel', 'LexisNexis Protege'],
    read: 'Madurez SaaS, workflows legales, portal cliente, confianza y drafting.',
  },
  {
    title: 'Fuentes Colombia',
    posture: 'Convertir en ventaja local',
    status: 'por_conectar',
    items: ['Rama Judicial', 'TYBA', 'SAMAI', 'Fiscalia', 'SECOP', 'SUIN', 'SIRNA'],
    read: 'Portales oficiales que deben producir senales, evidencia y planes.',
  },
];

const CAPABILITIES = [
  ['Gestion de casos', 'Sala viva', 'superar', 'Lemontech, Clio, Filevine'],
  ['Vigilancia procesal', 'Radar + plan de reaccion', 'mejorar', 'Lupa, LexID, Litigando'],
  ['IA juridica', 'IA conectada al expediente', 'diferenciar', 'RuleX, JuridAI, Veridic'],
  ['Workflows legales', 'Planes con aprobacion humana', 'integrar', 'Filevine, Legora, CoCounsel'],
  ['Portal cliente', 'Experiencia controlada y trazable', 'observar', 'Clio, Legora'],
  ['Drafting documental', 'Borrador desde fuentes y plantilla', 'mejorar', 'Harvey, CoCounsel, RuleX'],
  ['Operacion omnicanal', 'Recepcion inteligente', 'integrar', 'Clio, workflow, Zapier'],
  ['Datos Colombia', 'Radar Colombia', 'superar', 'Lupa, LexID, portales oficiales'],
  ['Mejora continua', 'Mejora del despacho', 'superar', 'Pocos lo muestran explicitamente'],
];

function GroupCard({ group }) {
  return (
    <article className="ops-card radar-group-card">
      <div className="ops-card-head">
        <div>
          <div className="ops-kicker">{group.posture}</div>
          <h3>{group.title}</h3>
        </div>
        <CapabilityStatus status={group.status} />
      </div>
      <p>{group.read}</p>
      <div className="entity-stack">
        {group.items.map(item => <span key={item}>{item}</span>)}
      </div>
    </article>
  );
}

export default function CompetitiveRadar() {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Radar Competitivo</div>
          <div className="page-subtitle">Señales de mercado, aliados tecnológicos, brechas y experimentos de mejora.</div>
        </div>
      </div>

      <div className="page-body">
        <section className="ops-hero">
          <div>
            <div className="ops-label">Inteligencia estrategica</div>
            <h2>Opus aprende del mercado sin copiarlo.</h2>
            <p>
              El radar compara capacidades, decide respuesta estratégica y convierte señales
              externas en experimentos de producto aterrizados al método SC LegalTech.
            </p>
          </div>
          <div className="ops-hero-metrics">
            <div><span>Fuentes</span><strong>30+</strong></div>
            <div><span>Capacidades</span><strong>{CAPABILITIES.length}</strong></div>
            <div><span>Cadencia</span><strong>Semanal</strong></div>
            <div><span>Modulo</span><strong>MVP</strong></div>
          </div>
        </section>

        <div className="ops-card-grid two">
          {GROUPS.map(group => <GroupCard key={group.title} group={group} />)}
        </div>

        <section className="ops-section">
          <div className="ops-section-head">
            <div>
              <span>Matriz inicial</span>
              <h3>Capacidad observada / brecha / respuesta</h3>
            </div>
            <CapabilityStatus status="prototipo" />
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Capacidad</th>
                  <th>Estado deseado Opus</th>
                  <th>Respuesta</th>
                  <th>Referentes</th>
                </tr>
              </thead>
              <tbody>
                {CAPABILITIES.map(([capability, opus, response, refs]) => (
                  <tr key={capability}>
                    <td>{capability}</td>
                    <td>{opus}</td>
                    <td><span className={`response-chip response-${response}`}>{response}</span></td>
                    <td>{refs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
