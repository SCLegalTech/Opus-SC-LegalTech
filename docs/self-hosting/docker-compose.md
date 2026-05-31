# Docker Compose Self-Hosting

This guide covers the local self-hosted stack included in the public release.

## Requirements

- Docker Engine or Docker Desktop
- Docker Compose v2
- At least 4 GB free memory for the full stack

## Setup

```bash
cp .env.example .env
```

Set required values:

```bash
DB_PASSWORD=change-me
JWT_SECRET=change-me-32-byte-secret
```

Generate secrets with:

```bash
openssl rand -hex 32
```

Start:

```bash
docker compose up -d
```

Check:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/health/live
```

Open `http://localhost:5173`.

## Optional Providers

Configure only what you use:

- `GEMINI_API_KEY` for Gemini.
- `OPENAI_API_KEY` for OpenAI.
- `OLLAMA_BASE_URL` and model variables for local models.
- Google OAuth variables for Workspace integrations.
- SMTP variables for email.
- Meta/WhatsApp variables for WhatsApp Business.
- MCP tokens for protected MCP access.

## Judicial Connectors

Self-hosted includes stubs only. They should return clear limitation messages and
must not request or store real judicial credentials unless you implement and
operate your own adapter.

## Troubleshooting

If backend liveness works but readiness reports database errors, confirm
PostgreSQL is healthy:

```bash
docker compose ps
docker compose logs postgres
docker compose logs backend
```

If frontend cannot reach the API, review `CORS_ORIGINS` and
`VITE_API_PROXY_TARGET`.
