# Módulo · `gmail-sync`

> Integración de Gmail como fuente de comunicaciones de caso.
> Parte del core operativo de Opus · Fase **Nigredo**.

---

## 1. Propósito

Permitir que los correos de Gmail de un abogado queden asociados a un caso en Opus como registros de tipo `email` dentro de la tabla `communications`.

Este módulo es la **primera integración con Google Workspace** y cumple con un criterio de salida de Nigredo:

> *"Gmail y Drive ya alimentan el sistema en algún nivel operativo."*
> — `docs/construccion/roadmap-mvp.md`

---

## 2. Decisión arquitectónica

Se implementa como **módulo interno del monolito** (`backend/src/modules/gmail-sync/`), no como microservicio separado.

Esto respeta la decisión irreversible del roadmap:

> *"monolito_modular_antes_de_microservicios: Separar dominios y contratos antes de separar despliegues."*
> — `docs/construccion/roadmap-mvp.md`

El módulo está **diseñado para ser extraíble**: toda interacción con el core pasa por un único puerto (`adapters/communications.port.js`). Cuando el contrato esté probado en Albedo, puede promoverse a microservicio sustituyendo ese archivo por llamadas HTTP al core.

---

## 3. Estructura

```
backend/src/modules/gmail-sync/
├── index.js                          # superficie pública: { accountRouter, caseRouter }
├── gmailClient.js                    # wrapper sobre googleapis (OAuth + Gmail API)
├── gmailAccounts.repository.js       # persistencia en tabla `gmail_accounts`
├── gmailSync.service.js              # orquestación del flujo
├── gmailAuth.controller.js           # handlers HTTP del flujo OAuth
├── gmailSync.controller.js           # handlers HTTP de sync por caso
├── adapters/
│   └── communications.port.js        # ÚNICO punto de contacto con tabla communications
└── README.md
```

### Regla de oro

Ningún archivo del módulo (excepto `adapters/communications.port.js`) puede importar `config/db` ni tocar tablas del core. Toda escritura/lectura sobre `communications` pasa por el puerto.

---

## 4. Contrato (endpoints)

### 4.1 Nivel cuenta — `/api/gmail`

| Método | Ruta                    | Auth         | Descripción                                      |
|--------|-------------------------|--------------|--------------------------------------------------|
| GET    | `/auth/url`             | JWT          | Devuelve `{ url }` para iniciar OAuth.           |
| GET    | `/auth/callback`        | state token  | Callback de Google. Redirige al frontend.        |
| GET    | `/status`               | JWT          | `{ connected, email, connected_at }`             |
| POST   | `/disconnect`           | JWT          | Elimina la cuenta OAuth del usuario.             |

### 4.2 Nivel caso — `/api/cases/:caseId/gmail`

| Método | Ruta         | Auth | Descripción                                                          |
|--------|--------------|------|----------------------------------------------------------------------|
| POST   | `/sync`      | JWT  | Importa correos. Body: `{ query?, threadId?, maxResults? }`          |
| GET    | `/messages`  | JWT  | Lista communications tipo `email` con `metadata.source = 'gmail'`.   |

**Ejemplos:**

```bash
# 1) Obtener URL de autorización
curl -H "Authorization: Bearer $JWT" http://localhost:4000/api/gmail/auth/url

# 2) Verificar estado
curl -H "Authorization: Bearer $JWT" http://localhost:4000/api/gmail/status

# 3) Sincronizar a un caso por query de Gmail
curl -X POST http://localhost:4000/api/cases/123/gmail/sync \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"query":"from:cliente@ejemplo.com newer_than:30d","maxResults":10}'

# 4) Sincronizar un hilo específico
curl -X POST http://localhost:4000/api/cases/123/gmail/sync \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"threadId":"18c1f2a0b3..."}'
```

---

## 5. Modelo de datos

### 5.1 Tabla propia — `gmail_accounts`

Migración: `database/migration_v4_v5_gmail_sync.sql`.

```sql
CREATE TABLE gmail_accounts (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email          VARCHAR(255),
  access_token   TEXT,
  refresh_token  TEXT,
  token_expiry   TIMESTAMP,
  scope          TEXT,
  created_at     TIMESTAMP,
  updated_at     TIMESTAMP,
  UNIQUE(user_id)
);
```

### 5.2 Cómo se persiste un correo

El módulo NO crea una tabla de correos. Persiste en la tabla existente `communications`:

- `type` = `'email'`
- `content` = texto legible (asunto, de, para, fecha, cuerpo).
- `metadata` (JSONB):
  ```json
  {
    "source": "gmail",
    "gmail_message_id": "18c1f2a0b3...",
    "gmail_thread_id":  "18c1f2a0b3...",
    "from":    "cliente@ejemplo.com",
    "to":      "abogado.demo@example.com",
    "cc":      null,
    "subject": "Consulta urgente",
    "date":    "Thu, 17 Apr 2026 10:00:00 -0500",
    "snippet": "Buenas tardes...",
    "label_ids": ["INBOX","IMPORTANT"]
  }
  ```

### 5.3 Idempotencia

Antes de insertar, el puerto verifica que no exista una communication con el mismo `metadata->>'gmail_message_id'` para ese caso. Un correo sincronizado dos veces cuenta como `skipped`.

Índice de apoyo (creado por la migración):

```sql
CREATE INDEX idx_comms_gmail_msg_id
  ON communications ((metadata->>'gmail_message_id'))
  WHERE metadata ? 'gmail_message_id';
```

---

## 6. Configuración

Variables requeridas en `.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4000/api/gmail/auth/callback
```

Crear credenciales en [Google Cloud Console](https://console.cloud.google.com/apis/credentials) tipo **Web application**. La URI de redirección debe coincidir exactamente.

**Scopes solicitados:**

- `https://www.googleapis.com/auth/gmail.readonly` — solo lectura. El módulo no envía correos en esta fase.
- `https://www.googleapis.com/auth/userinfo.email` — para identificar la cuenta conectada.

---

## 7. Flujo de uso

1. Usuario autenticado llama `GET /api/gmail/auth/url`.
2. Frontend redirige al navegador a la URL retornada.
3. Usuario consiente en la pantalla de Google.
4. Google redirige a `/api/gmail/auth/callback?code=...&state=...`.
5. El módulo valida `state` (JWT firmado con `JWT_SECRET`, TTL 10 min), intercambia el código por tokens y los persiste.
6. El usuario queda conectado. El frontend puede llamar `GET /api/gmail/status` para confirmar.
7. Desde el detalle de caso, el usuario puede disparar `POST /api/cases/:caseId/gmail/sync` con un query de Gmail o un `threadId`.
8. Los correos quedan visibles en el historial de comunicaciones del caso.

---

## 8. Límites conocidos y trabajo futuro

- **Sólo lectura.** No envía correos ni mueve etiquetas.
- **Una cuenta por usuario.** Para escenarios multi-cuenta (buzón compartido) requiere diseño adicional.
- **Sin sincronización continua.** Cada sync es una acción manual. Un `watch` de Gmail Pub/Sub o un job periódico se evaluarán en Albedo.
- **Sin adjuntos.** El cuerpo se extrae en texto plano. Los adjuntos de Drive se tratarán en el módulo `drive-sync` cuando exista.
- **Sin clasificación semántica.** La asociación caso-correo es explícita (abogado decide). La clasificación automática con IA queda para Albedo.

---

## 9. Extracción futura a microservicio

Cuando el contrato esté probado, la extracción requiere:

1. Mover `backend/src/modules/gmail-sync/` a un servicio nuevo (`services/gmail-sync-service/`).
2. Reemplazar `adapters/communications.port.js` por un cliente HTTP que llame a una API pública del core (p. ej. `POST /api/cases/:id/communications`).
3. Mover la tabla `gmail_accounts` a la BD del microservicio (o mantenerla en la BD del core y leerla vía API).
4. Registrar el servicio en `docker-compose.yml` y enrutar desde un gateway.

El resto del módulo (client, service, controllers) queda intacto.
