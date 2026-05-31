/**
 * tools/drive.js — Herramientas Google Drive orientadas a expediente
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (4):
 *   drive_search_for_case      — Busca en Drive archivos relacionados con un caso
 *                                (por número de caso, nombre del cliente y documento).
 *   drive_link_folder_to_case  — Vincula una carpeta Drive existente como raíz
 *                                del expediente del caso.
 *   drive_organize_expediente  — Crea estructura canónica de subcarpetas y
 *                                opcionalmente mueve + vincula archivos.
 *   drive_list_case_files      — Lista los archivos Drive ya vinculados al caso.
 *
 * Todas las tools hablan con el backend vía /api/v1/cases/:id/drive/*.
 * Las operaciones de escritura (crear carpetas, mover archivos) requieren
 * que la cuenta Google conectada tenga scope `drive` full. Si sólo hay
 * `drive.readonly`, el backend devolverá code=DRIVE_SCOPE_REQUIRED y el
 * abogado deberá reconectar desde Ajustes → Integraciones.
 */

import { z } from 'zod';
import { get, post } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok   = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err  = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

const CaseId = z.string().describe(
  'ID numérico o UUID del caso. Ejemplo: "42" o "SC-2026-0007".'
);

// Categorías aceptadas en case_drive_files (repo backend).
const Category = z.enum([
  'sin_clasificar',
  'poder',
  'contrato',
  'ingreso',
  'cliente',
  'demanda',
  'actuacion',
  'comunicacion',
  'prueba',
  'borrador',
  'firmado',
]).describe(
  'Categoría del documento dentro del expediente. Determina la subcarpeta destino.'
);

export function registerDriveTools(server) {

  // 1. drive_search_for_case
  server.tool(
    'drive_search_for_case',
    'Busca en Google Drive archivos relacionados con un caso. Usa automáticamente el número de caso, el nombre completo del cliente y su documento como términos de búsqueda. Útil cuando el abogado pide "encuentra todo lo que tengo de este cliente en Drive".',
    {
      case_id:      CaseId,
      q:            z.string().optional()
                      .describe('Término adicional para enriquecer la búsqueda (ej. número de radicado).'),
      max_per_term: z.number().int().min(1).max(25).default(10)
                      .describe('Máximo de resultados por cada término de búsqueda.'),
    },
    async ({ case_id, q, max_per_term }) => {
      try {
        return ok(await get(`/cases/${case_id}/drive/search-for-client`, { q, max_per_term }));
      } catch (e) { return err(e); }
    }
  );

  // 2. drive_link_folder_to_case
  server.tool(
    'drive_link_folder_to_case',
    'Vincula una carpeta existente de Google Drive como raíz del expediente del caso. No crea ni modifica nada en Drive: sólo guarda el ID y URL en el registro del caso. Útil cuando el expediente ya existe en Drive y sólo se necesita conectarlo al sistema.',
    {
      case_id:   CaseId,
      folder_id: z.string().min(5).describe('ID de la carpeta Drive (no la URL, sólo el ID).'),
    },
    async ({ case_id, folder_id }) => {
      try {
        return ok(await post(`/cases/${case_id}/drive/expediente/link-folder`, { folder_id }));
      } catch (e) { return err(e); }
    }
  );

  // 3. drive_organize_expediente
  server.tool(
    'drive_organize_expediente',
    'Organiza el expediente del caso en Drive: asegura que exista la carpeta raíz del caso, crea las subcarpetas canónicas (00_Poderes, 01_Contratos, 02_Demanda, 03_Actuaciones, 04_Pruebas, 05_Comunicaciones, 06_Borradores, 99_Sin_clasificar) y, si se pasan archivos, los mueve a la subcarpeta correspondiente según su categoría y los vincula al caso. Usa dry_run=true para previsualizar sin tocar Drive. Requiere scope drive full en la cuenta Google conectada.',
    {
      case_id:          CaseId,
      parent_folder_id: z.string().optional()
                          .describe('ID de la carpeta Drive donde crear la raíz del expediente si aún no existe. Omitir = "Mi unidad".'),
      dry_run:          z.boolean().default(false)
                          .describe('true = devolver plan sin ejecutar. Recomendado para la primera llamada.'),
      files:            z.array(z.object({
                          drive_file_id: z.string().describe('ID del archivo en Drive.'),
                          category:      Category.default('sin_clasificar'),
                        })).optional()
                          .describe('Archivos a mover y vincular. Cada uno se clasifica en su subcarpeta por categoría.'),
    },
    async ({ case_id, parent_folder_id, dry_run, files }) => {
      try {
        return ok(await post(`/cases/${case_id}/drive/expediente/organize`, {
          parent_folder_id,
          dry_run,
          files: files || [],
        }));
      } catch (e) { return err(e); }
    }
  );

  // 4. drive_list_case_files
  server.tool(
    'drive_list_case_files',
    'Lista los archivos Drive ya vinculados al caso (tabla case_drive_files). No consulta Drive en vivo: devuelve el expediente documental tal como está registrado en el sistema.',
    { case_id: CaseId },
    async ({ case_id }) => {
      try {
        return ok(await get(`/cases/${case_id}/drive/files`));
      } catch (e) { return err(e); }
    }
  );
}
