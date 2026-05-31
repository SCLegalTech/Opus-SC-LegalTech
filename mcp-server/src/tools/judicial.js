import { z } from 'zod';

const response = (extra = {}) => ({
  content: [{
    type: 'text',
    text: JSON.stringify({
      code: 'JUDICIAL_CASE_TRACKING_STUB',
      mode: 'self_hosted_stub',
      message: 'This public self-hosted release exposes case-tracking contracts and stubs only.',
      boundary: 'Court filing, delegated credential use, browser automation, and legal-act submission are not included.',
      ...extra,
    }, null, 2),
  }],
});

export function registerJudicialTools(server) {
  server.tool(
    'judicial_case_tracking_platforms',
    'Lists public case-tracking adapter slots available for this self-hosted instance.',
    { country: z.string().optional(), jurisdiction: z.string().optional() },
    async () => response({
      platforms: [
        { key: 'cpnu', label: 'Consulta de Procesos Nacional Unificada', access: 'public_read_only' },
        { key: 'tyba', label: 'Justicia XXI / TYBA', access: 'public_or_operator_defined' },
        { key: 'samai_public', label: 'SAMAI public tracking', access: 'public_or_operator_defined' },
      ],
    })
  );

  server.tool(
    'judicial_case_tracking_lookup',
    'Looks up read-only public case status through an operator-provided adapter.',
    {
      platform_key: z.string().min(2),
      process_number: z.string().min(3),
      dry_run: z.boolean().default(true),
    },
    async ({ platform_key, process_number, dry_run }) => response({
      platform_key,
      process_number,
      dry_run,
      available: false,
      next_step: 'Implement an adapter that reads public case-tracking data and normalizes timeline events.',
    })
  );

  server.tool(
    'judicial_case_tracking_link',
    'Returns the expected payload for linking a public case-tracking result to an Opus case.',
    {
      case_id: z.number().int().positive(),
      platform_key: z.string().min(2),
      process_number: z.string().min(3),
    },
    async (args) => response({
      ...args,
      linked: false,
      next_step: 'Use the backend case-tracking endpoints or implement your own adapter persistence.',
    })
  );
}
