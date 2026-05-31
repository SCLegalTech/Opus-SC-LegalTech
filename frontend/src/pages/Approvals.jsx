import CapabilityStatus from '../components/CapabilityStatus';

export default function Approvals() {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Autorizaciones</div>
          <div className="page-subtitle">Control humano para cambios internos y acciones sensibles dentro de Opus.</div>
        </div>
      </div>

      <div className="page-body">
        <section className="ops-hero">
          <div>
            <div className="ops-label">Control humano</div>
            <h2>La IA propone; la firma autoriza.</h2>
            <p>
              El release self-hosted conserva la compuerta humana para planes y cambios internos.
              Las aprobaciones judiciales de radicacion, credenciales delegadas y automatizacion de portales no se publican.
            </p>
          </div>
          <div className="approval-command">
            <CapabilityStatus status="disponible" />
            <strong>Sin aprobaciones externas</strong>
            <span>Solo flujos locales de la instancia self-hosted.</span>
          </div>
        </section>

        <section className="ops-lens-grid">
          <div className="ops-lens"><span>Contexto</span><p>Que caso, tarea o documento origina la recomendacion.</p></div>
          <div className="ops-lens"><span>Sugerencia</span><p>Que cambio propone el agente antes de ejecutarse.</p></div>
          <div className="ops-lens"><span>Riesgo</span><p>Que puede salir mal si se aprueba sin revision.</p></div>
          <div className="ops-lens"><span>Accion</span><p>Aprobar, ajustar o rechazar dentro del flujo local.</p></div>
          <div className="ops-lens"><span>Rastro</span><p>Registro auditable de decision, usuario y resultado.</p></div>
        </section>

        <article className="ops-card approval-card">
          <div className="ops-card-head">
            <div>
              <div className="ops-kicker">Bandeja limpia</div>
              <h3>No hay solicitudes pendientes</h3>
            </div>
            <CapabilityStatus status="disponible" />
          </div>
          <p className="approval-empty-copy">
            Cuando un plan local requiera aprobacion humana, quedara registrado en la instancia.
            Los conectores publicos de case tracking no deben ejecutar actos juridicos externos.
          </p>
        </article>
      </div>
    </>
  );
}
