const STATUS_CONFIG = {
  activo: {
    label: 'Activo',
    className: 'capability-status-active',
  },
  prototipo: {
    label: 'Prototipo',
    className: 'capability-status-prototype',
  },
  por_conectar: {
    label: 'Por conectar',
    className: 'capability-status-connect',
  },
  bloqueado: {
    label: 'Bloqueado',
    className: 'capability-status-blocked',
  },
  manual_asistido: {
    label: 'Manual asistido',
    className: 'capability-status-manual',
  },
};

const normalizeStatus = (status = '') =>
  String(status).trim().toLowerCase().replace(/\s+/g, '_');

export default function CapabilityStatus({ status, compact = false }) {
  const key = normalizeStatus(status);
  const config = STATUS_CONFIG[key] || STATUS_CONFIG.por_conectar;

  return (
    <span className={`capability-status ${config.className}${compact ? ' compact' : ''}`}>
      {config.label}
    </span>
  );
}

export { STATUS_CONFIG };
