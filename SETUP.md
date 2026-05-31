# Opus Self-Hosted Setup / Instalacion Self-Hosted

This guide is for running the public self-hosted edition of Opus locally or on
infrastructure you control.

Esta guia sirve para ejecutar la edicion publica self-hosted de Opus en local o
en infraestructura administrada por el operador.

## 1. Requirements / Requisitos

- Docker Desktop or Docker Engine with Docker Compose.
- Git.
- 4 GB RAM minimum for the stack; 8 GB recommended.
- Optional for non-Docker development: Node.js 20+ and PostgreSQL 16+.

## 2. Get The Code / Obtener El Codigo

```bash
git clone https://github.com/SCLegalTech/Opus-SC-LegalTech.git
cd Opus-SC-LegalTech
```

If you are testing a private preview, use the repository URL you were given.

Si estas probando un preview privado, usa la URL del repositorio que te fue
compartida.

## 3. Configure Environment / Configurar Variables

Create your local environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Set at least these required values:

```env
DB_PASSWORD=change-this-password
JWT_SECRET=change-this-32-byte-minimum-secret
```

Recommended token generation:

```bash
openssl rand -hex 32
```

Optional integrations can stay empty until you use them:

- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- `MCP_API_TOKEN`, `MCP_HTTP_AUTH_TOKEN`

Do not commit `.env`.

No publiques ni subas `.env` al repositorio.

## 4. Start With Docker / Iniciar Con Docker

```bash
docker compose up -d --build
```

Check containers:

```bash
docker compose ps
```

Health checks:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/health/live
```

Open:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`
- MCP server: `http://localhost:4001`

## 5. Demo Accounts / Cuentas Demo

The database seed creates demo users for local evaluation:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin.demo@example.com` | `demo-admin-password` |
| Lawyer | `abogado.demo@example.com` | `demo-lawyer-password` |

Change or remove demo credentials before using Opus with real data.

Cambia o elimina estas credenciales antes de usar Opus con datos reales.

## 6. Database Initialization / Inicializacion De Base De Datos

With Docker, PostgreSQL runs the schema and seed automatically on first startup:

- `database/schema.sql`
- `database/seed.sql`

If you need a clean local database, remove the Docker volume and start again:

```bash
docker compose down -v
docker compose up -d --build
```

This deletes local database data.

Esto elimina los datos locales de la base de datos.

## 7. MCP Server / Servidor MCP

The Docker stack starts the MCP server at:

```text
http://localhost:4001
```

The MCP server talks to the backend through:

```env
MCP_API_URL=http://backend:4000/api/v1
```

For local HTTP protection, set:

```env
MCP_HTTP_AUTH_TOKEN=change-this-token
MCP_API_TOKEN=change-this-token
```

## 8. AI Providers / Proveedores De IA

Opus can run with different AI providers depending on your configuration.

For Gemini:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
```

For OpenAI:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-4o-mini
```

For a local Ollama runtime:

```bash
ollama pull qwen2.5:0.5b
```

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

On Linux, replace `host.docker.internal` if your Docker setup does not expose
that hostname.

## 9. Optional Integrations / Integraciones Opcionales

Configure only what you intend to use:

- Google Workspace: Gmail, Drive and Calendar OAuth credentials.
- WhatsApp Business: Meta Cloud API credentials.
- SMTP: outbound email credentials.
- Judicial case tracking: public read-only adapter stubs only.

The public self-hosted release does not include maintained judicial last-mile
connectors, filing/submission automation, delegated court credentials, payment
provider integrations, SaaS billing, or commercial hosted operations.

La edicion publica self-hosted no incluye conectores judiciales mantenidos de
ultima milla, automatizacion de radicacion/presentacion, credenciales judiciales
delegadas, integraciones de pago, billing SaaS ni operacion hosted comercial.

## 10. Local Development Without Docker / Desarrollo Local Sin Docker

Use Docker for PostgreSQL, or run PostgreSQL 16+ yourself.

Install backend dependencies:

```bash
cd backend
npm ci
npm run dev
```

Install frontend dependencies:

```bash
cd frontend
npm ci
npm run dev
```

Install MCP server dependencies:

```bash
cd mcp-server
npm ci
npm run dev
```

When running outside Docker, make sure `.env` points to your local PostgreSQL
host and credentials.

## 11. Verification / Verificacion

Run these checks before using the instance with real data:

```bash
docker compose config --quiet
```

```bash
cd backend && npm audit --omit=dev
cd ../frontend && npm audit --omit=dev
cd ../mcp-server && npm audit --omit=dev
```

```bash
cd frontend
npm run build
```

## 12. Stop, Restart, Reset / Detener, Reiniciar, Resetear

Stop services:

```bash
docker compose down
```

Restart services:

```bash
docker compose restart
```

Delete containers and local database volume:

```bash
docker compose down -v
```

## 13. Troubleshooting / Solucion De Problemas

Backend cannot connect to database:

- Check `DB_PASSWORD` in `.env`.
- Run `docker compose ps`.
- Confirm `postgres` is healthy.

Frontend cannot reach backend:

- Confirm backend health at `http://localhost:4000/api/health`.
- Check `VITE_API_PROXY_TARGET` in `docker-compose.yml`.

Login fails with demo accounts:

- Confirm the database was initialized with `database/seed.sql`.
- If you changed seed data, recreate the local volume with `docker compose down -v`.

AI requests fail:

- Confirm the selected provider in `AI_PROVIDER`.
- Confirm the required API key or local runtime is configured.
- If using Ollama, confirm the model is installed and the runtime is reachable.

## 14. Security Notes / Notas De Seguridad

Before using Opus with real legal data:

- Change all demo passwords.
- Set a strong `JWT_SECRET`.
- Set MCP auth tokens.
- Configure HTTPS at your reverse proxy or hosting layer.
- Restrict database access.
- Review provider terms for AI, Google Workspace, WhatsApp and SMTP.
- Do not store real court credentials unless you implement and audit your own
  adapter and secret-handling controls.
- Do not commit `.env`, database dumps, client files, PDFs, spreadsheets,
  recordings, screenshots or production deployment files.

For vulnerability reporting, see [SECURITY.md](SECURITY.md).
