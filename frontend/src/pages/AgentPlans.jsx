import CapabilityStatus from '../components/CapabilityStatus';

const PLANS = [
  {
    id: 'plan-gmail-expediente',
    title: 'Organizar hilo Gmail en expediente vivo',
    caseRef: 'Caso activo',
    status: 'prototipo',
    risk: 'Medio',
    nextStep: 'Asociar hilo al caso y proponer tareas derivadas.',
    approval: 'No requiere autorización para lectura; sí para enviar respuesta.',
    steps: [
      ['Leer hilo Gmail', 'Activo', 'Gmail conectado desde Recepcion'],
      ['Asociar al caso', 'Activo', 'Sin mover ni borrar el correo original'],
      ['Extraer faltantes', 'Prototipo', 'La Sala genera preguntas y tareas'],
      ['Redactar respuesta', 'Por conectar', 'Borrador requiere fuentes y revision'],
      ['Enviar correo', 'Bloqueado', 'Debe pasar por Autorizaciones'],
    ],
  },
  {
    id: 'plan-radar-proceso',
    title: 'Vigilar radicado colombiano y registrar seguimiento',
    caseRef: 'Radar Colombia',
    status: 'manual_asistido',
    risk: 'Alto',
    nextStep: 'Guiar consulta manual y registrar evidencia capturada.',
    approval: 'Requiere abogado para validar fuente, estado y accion interna sugerida.',
    steps: [
      ['Abrir portal oficial', 'Manual asistido', 'CPNU, TYBA o SAMAI segun caso'],
      ['Registrar evidencia', 'Prototipo', 'Fecha, fuente y captura pendiente'],
      ['Detectar cambio', 'Por conectar', 'Conector futuro con comparacion'],
      ['Proponer accion interna', 'Prototipo', 'Sala sugiere tarea o revision'],
      ['Actualizar tracking', 'Bloqueado', 'Solo registra seguimiento de lectura'],
    ],
  },
  {
    id: 'plan-documento',
    title: 'Borrador desde expediente, fuentes y criterio',
    caseRef: 'Biblioteca / Sala',
    status: 'por_conectar',
    risk: 'Medio',
    nextStep: 'Conectar plantillas y fuentes verificables antes de exportar.',
    approval: 'Exportar o enviar documento sensible queda en Autorizaciones.',
    steps: [
      ['Recoger hechos', 'Activo', 'Caso, comunicaciones y tareas'],
      ['Consultar fuentes', 'Por conectar', 'Biblioteca y SUIN-Juriscol'],
      ['Redactar borrador', 'Prototipo', 'Debe mostrar supuestos y faltantes'],
      ['Revision humana', 'Activo', 'El abogado ajusta criterio'],
      ['Exportar final', 'Bloqueado', 'Pendiente de aprobacion y auditoria'],
    ],
  },
];

function PlanStep({ step, index }) {
  const [label, status, detail] = step;

  return (
    <div className="plan-step">
      <div className="plan-step-index">{index + 1}</div>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <CapabilityStatus status={status} compact />
    </div>
  );
}

function PlanCard({ plan }) {
  return (
    <article className="ops-card plan-card">
      <div className="ops-card-head">
        <div>
          <div className="ops-kicker">{plan.caseRef} · riesgo {plan.risk}</div>
          <h3>{plan.title}</h3>
        </div>
        <CapabilityStatus status={plan.status} />
      </div>

      <div className="ops-next-step">
        <span>Proximo paso</span>
        <strong>{plan.nextStep}</strong>
      </div>

      <div className="plan-steps">
        {plan.steps.map((step, index) => (
          <PlanStep key={`${plan.id}-${step[0]}`} step={step} index={index} />
        ))}
      </div>

      <div className="approval-note">
        <span>Checkpoint humano</span>
        <p>{plan.approval}</p>
      </div>
    </article>
  );
}

export default function AgentPlans() {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Planes de acción</div>
          <div className="page-subtitle">Secuencias de trabajo: pasos, herramientas, autorizaciones y rastro.</div>
        </div>
      </div>

      <div className="page-body">
        <section className="ops-hero">
          <div>
            <div className="ops-label">Plan / acción / autorización / auditoría</div>
            <h2>La firma actua por secuencias revisables.</h2>
            <p>
              Un plan no es una tarea suelta: es una cadena de lectura, contexto, accion reversible,
              checkpoint humano y log. Esta primera capa es visible aunque parte del backend esté por conectar.
            </p>
          </div>
          <div className="ops-hero-metrics">
            <div><span>Planes visibles</span><strong>{PLANS.length}</strong></div>
            <div><span>Con autorización</span><strong>3</strong></div>
            <div><span>Herramientas</span><strong>5</strong></div>
            <div><span>Backend</span><strong>Mixto</strong></div>
          </div>
        </section>

        <section className="ops-lens-grid">
          <div className="ops-lens"><span>Contexto</span><p>Cada plan parte de caso, correo, fuente o radicado.</p></div>
          <div className="ops-lens"><span>Lectura</span><p>La Sala interpreta senales antes de sugerir pasos.</p></div>
          <div className="ops-lens"><span>Riesgo</span><p>Acciones irreversibles quedan bloqueadas sin aprobacion.</p></div>
          <div className="ops-lens"><span>Accion</span><p>Pasos activos operan hoy; el resto muestra el contrato esperado.</p></div>
          <div className="ops-lens"><span>Rastro</span><p>Cada ejecucion debe dejar herramienta, parametros y resultado.</p></div>
        </section>

        <div className="ops-card-grid">
          {PLANS.map(plan => <PlanCard key={plan.id} plan={plan} />)}
        </div>
      </div>
    </>
  );
}
