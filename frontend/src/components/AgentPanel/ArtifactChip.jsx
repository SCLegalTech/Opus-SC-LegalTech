/**
 * ArtifactChip.jsx — Chip de artefacto en el panel de Claudia
 * Representa un item arrastrado (caso, tarea, cliente, etc.)
 */

import { useAgent } from '../../context/AgentContext';

const TYPE_LABELS = {
  case:       'Caso',
  task:       'Tarea',
  client:     'Cliente',
  macrocaso:  'Proyecto',
  deadline:   'Vencimiento',
  comm:       'Comunicación',
};

const TYPE_COLORS = {
  case:       'var(--gold)',
  task:       '#4A9ED4',
  client:     '#6EBA74',
  macrocaso:  '#8a7fd0',
  deadline:   '#D4724A',
  comm:       'var(--gray)',
};

export default function ArtifactChip({ artifact }) {
  const { removeArtifact } = useAgent();
  const color = TYPE_COLORS[artifact.type] || 'var(--gray)';
  const label = TYPE_LABELS[artifact.type] || artifact.type;

  return (
    <div className="artifact-chip" style={{ '--chip-color': color }}>
      <span className="artifact-chip-type">{label}</span>
      <span className="artifact-chip-title">{artifact.title}</span>
      {artifact.summary && (
        <span className="artifact-chip-summary">{artifact.summary}</span>
      )}
      <button
        className="artifact-chip-remove"
        onClick={() => removeArtifact(artifact.type, artifact.id)}
        title="Quitar del contexto"
      >
        ×
      </button>
    </div>
  );
}
