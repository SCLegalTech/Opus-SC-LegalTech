# Architecture

Opus is a monorepo with three primary runtime surfaces:

- `frontend/`: React + Vite web application.
- `backend/`: Node.js + Express API.
- `mcp-server/`: MCP server exposing selected Opus operations as tools.

Storage is PostgreSQL. Optional integrations include AI providers, Google
Workspace, WhatsApp Business, SMTP and workflow automations.

Important references:

- [Self-hosting with Docker](self-hosting/docker-compose.md)
- [Judicial Case Tracking via MCP](arquitectura/integraciones-judiciales-mcp.md)
- [Fair-Code ADR](arquitectura/adr-006-licencia-fair-code-source-available.md)
- [Closed Modules](operacion/closed-modules.md)

The public repository includes stubs for judicial connectors. Real judicial
last-mile automation remains outside the self-hosted fair-code release.
