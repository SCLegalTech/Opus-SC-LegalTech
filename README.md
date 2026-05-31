# Opus SC LegalTech

```text
+==============================================================================+
|                              OPUS SC LEGALTECH                               |
|                                                                              |
|        FAIR-CODE / SOURCE-AVAILABLE / SELF-HOSTED LEGAL OPERATIONS           |
+==============================================================================+

          @@@@@@@@@@@@@@@@@@@@@@@@@
                @@@@@@@@@@@@@
                  @@@@@@@@
                  @@@@@@@@
             @@@@@  @@@@@@@@@@@
           @@@@@@      @@@@@@@@@@@
         @@@@@@@        @@@@@@@@@@@
        @@@@@@@@          @@@@@@@@@@@
       @@@@@@@@@           @@@@@@@@@@
      @@@@@@@@@@            @@@@@@@@@@
      @@@@@@@@@@            @@@@@@@@@@
      @@@@@@@@@@            @@@@@@@@@@
       @@@@@@@@@@            @@@@@@@@@
       @@@@@@@@@@@          @@@@@@@@@
        @@@@@@@@@@@         @@@@@@@@
          @@@@@@@@@@@      @@@@@@@
            @@@@@@@@@@@   @@@@@@
                @@@@@@@@@@@@
                  @@@@@@@@
                @@@@@@@@@@@@@
          @@@@@@@@@@@@@@@@@@@@@@@@@

+==============================================================================+
| expediente | custodia | trazabilidad | criterio juridico | MCP | self-hosted |
+==============================================================================+
```

```text
[ ES ] ========================================================================
```

Opus SC LegalTech es un sistema self-hosted para la operacion diaria de una
firma, despacho o equipo legal. Su proposito es ordenar el expediente operativo:
clientes, casos, tareas, vencimientos, comunicaciones, documentos, aprobaciones,
fuentes, auditoria y herramientas MCP bajo control del propio operador.

Este repositorio no publica una vitrina comercial ni una automatizacion cerrada.
Publica el nucleo ejecutable de la edicion self-hosted: suficiente para operar,
inspeccionar, adaptar y contribuir dentro del alcance permitido por la licencia.

Opus no sustituye el criterio profesional, la revision de fuentes, el deber de
confidencialidad ni la aprobacion humana antes de una actuacion juridica.

Consulta [LICENSE](LICENSE), [COMMERCIAL.md](COMMERCIAL.md) y
[ADR-006](docs/arquitectura/adr-006-licencia-fair-code-source-available.md).

### [01] Acta De Alcance

| Materia | Edicion self-hosted |
| --- | --- |
| Clientes, casos, tareas, vencimientos y documentos | Incluido |
| Bandeja operativa, aprobaciones, auditoria y trazabilidad | Incluido |
| API, frontend, base de datos y servidor MCP | Incluido |
| Proveedores de IA | Opcionales, con credenciales del operador |
| Google Workspace, SMTP y WhatsApp Business | Opcionales, con credenciales del operador |
| Seguimiento judicial de consulta publica | Contratos y stubs incluidos |
| Radicacion judicial o presentacion de actos juridicos | No incluido |
| Uso delegado de credenciales o automatizacion autenticada de portales | No incluido |
| Pagos, billing SaaS, planes comerciales y cuotas multi-tenant | No incluido |
| Operacion administrada, monitoreo privado y soporte enterprise | No incluido |

### [02] Mapa Del Sistema

```text
frontend/      Interfaz web React + Vite
backend/       API Node.js + Express
mcp-server/    Herramientas MCP para operaciones seleccionadas de Opus
database/      Baseline PostgreSQL limpio y datos demo sinteticos
docs/          Alcance publico, self-hosting y frontera de licencia
```

```text
usuario -> frontend -> backend API -> PostgreSQL
                              |
                              +-> MCP server
                              +-> proveedores externos configurados por operador
```

### [03] Puesta En Marcha

Requisitos:

- Docker Engine o Docker Desktop con Docker Compose v2.
- Node.js 20 si vas a ejecutar servicios fuera de Docker.

Prepara variables locales:

```bash
cp .env.example .env
```

Define al menos:

```bash
DB_PASSWORD=change-me
JWT_SECRET=change-me-32-byte-secret
```

Levanta el stack:

```bash
docker compose up -d
```

Verifica:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/health/live
```

Accesos locales:

| Servicio | URL |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend API | `http://localhost:4000` |
| MCP server | `http://localhost:4001` |

Cuentas demo de `database/seed.sql`:

| Rol | Email | Password |
| --- | --- | --- |
| Admin | `admin.demo@example.com` | `demo-admin-password` |
| Lawyer | `abogado.demo@example.com` | `demo-lawyer-password` |

### [04] Configuracion

Configura solo los proveedores que realmente operes:

| Categoria | Variables principales |
| --- | --- |
| Base de datos | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Seguridad API | `JWT_SECRET`, `CORS_ORIGINS` |
| IA | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL` |
| Google Workspace | OAuth client id/secret y redirect URI |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| WhatsApp Business | Credenciales Meta Cloud API propias del operador |
| MCP | `MCP_API_TOKEN`, `MCP_HTTP_AUTH_TOKEN` |

Guia extendida: [docs/self-hosting/docker-compose.md](docs/self-hosting/docker-compose.md).

### [05] Frontera Judicial

La edicion publica permite modelar seguimiento judicial de consulta publica:
consultar fuentes permitidas, normalizar eventos, conservar atribucion de fuente
y asociar el resultado a un caso de Opus.

No publica radicacion, memoriales, demandas, PQRS, recursos, uso delegado de
credenciales, OTP/MFA, captcha, browser automation autenticada, grabaciones,
screenshots operativos ni playbooks de produccion.

Ver:

- [docs/arquitectura/integraciones-judiciales-mcp.md](docs/arquitectura/integraciones-judiciales-mcp.md)
- [docs/operacion/closed-modules.md](docs/operacion/closed-modules.md)

### [06] Desarrollo Y Validacion

```bash
cd backend && npm ci
cd ../frontend && npm ci
cd ../mcp-server && npm ci
```

Checks:

```bash
cd backend && npm audit --omit=dev
cd ../frontend && npm audit --omit=dev && npm run build
cd ../mcp-server && npm audit --omit=dev
```

Smoke MCP:

```bash
cd mcp-server
node --input-type=module -e "import('./src/server.js').then(({ createServer }) => { createServer(); console.log('mcp tools registered'); process.exit(0); })"
```

### [07] Custodia Y Seguridad

No publiques ni subas:

- secretos, tokens, `.env` reales o llaves privadas;
- datos reales de clientes, casos, despachos, juzgados o terceros;
- dumps, backups, PDFs, hojas de calculo, grabaciones o screenshots operativos;
- credenciales judiciales o credenciales de proveedores externos;
- configuraciones privadas de produccion o infraestructura administrada.

Reporta vulnerabilidades por el canal privado definido en [SECURITY.md](SECURITY.md).

### [08] Contribuciones

Son bienvenidas las contribuciones sobre:

- documentacion publica;
- self-hosting;
- pruebas y CI;
- experiencia de usuario de la edicion self-hosted;
- conectores de seguimiento judicial publico cuando la fuente permita ese uso;
- adaptadores genericos que no dependan de automatizacion cerrada.

Antes de abrir un PR, revisa [CONTRIBUTING.md](CONTRIBUTING.md).

### [09] Licencia Y Uso Comercial

Opus SC LegalTech se publica bajo una licencia fair-code/source-available.
El uso interno self-hosted permitido esta descrito en [LICENSE](LICENSE).

Requieren acuerdo comercial separado:

- operar Opus para terceros;
- ofrecer hosting administrado;
- revender, sublicenciar o white-label;
- embeber Opus en un producto comercial;
- usar Opus para construir un servicio competitivo.

Contacto comercial: [COMMERCIAL.md](COMMERCIAL.md).

---

```text
[ EN ] ========================================================================
```

Opus SC LegalTech is a self-hosted system for the daily operation of a legal
firm, legal department or legal team. Its purpose is to organize the operational
case file: clients, cases, tasks, deadlines, communications, documents,
approvals, sources, audit records and MCP tools under the operator's control.

This repository is not a commercial storefront and does not publish closed
automation. It publishes the executable core of the self-hosted edition: enough
to run, inspect, adapt and contribute within the license boundary.

Opus does not replace professional judgment, source review, confidentiality
duties or human approval before legal action.

See [LICENSE](LICENSE), [COMMERCIAL.md](COMMERCIAL.md) and
[ADR-006](docs/arquitectura/adr-006-licencia-fair-code-source-available.md).

### [01] Scope Of Record

| Matter | Self-hosted edition |
| --- | --- |
| Clients, cases, tasks, deadlines and documents | Included |
| Operational inbox, approvals, audit records and traceability | Included |
| API, frontend, database and MCP server | Included |
| AI providers | Optional, with operator-owned credentials |
| Google Workspace, SMTP and WhatsApp Business | Optional, with operator-owned credentials |
| Public judicial case-tracking lookup | Contracts and stubs included |
| Court filing or legal-act submission | Not included |
| Delegated credentials or authenticated portal automation | Not included |
| Payments, SaaS billing, commercial plans and multi-tenant quotas | Not included |
| Managed operations, private monitoring and enterprise support | Not included |

### [02] System Map

```text
frontend/      React + Vite web interface
backend/       Node.js + Express API
mcp-server/    MCP tools for selected Opus operations
database/      Clean PostgreSQL baseline and synthetic demo data
docs/          Public scope, self-hosting and license boundary
```

```text
user -> frontend -> backend API -> PostgreSQL
                         |
                         +-> MCP server
                         +-> external providers configured by operator
```

### [03] First Run

Requirements:

- Docker Engine or Docker Desktop with Docker Compose v2.
- Node.js 20 if running services outside Docker.

Prepare local variables:

```bash
cp .env.example .env
```

Set at least:

```bash
DB_PASSWORD=change-me
JWT_SECRET=change-me-32-byte-secret
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

Local services:

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend API | `http://localhost:4000` |
| MCP server | `http://localhost:4001` |

Demo accounts from `database/seed.sql`:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin.demo@example.com` | `demo-admin-password` |
| Lawyer | `abogado.demo@example.com` | `demo-lawyer-password` |

### [04] Configuration

Configure only the providers you actually operate:

| Category | Main variables |
| --- | --- |
| Database | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| API security | `JWT_SECRET`, `CORS_ORIGINS` |
| AI | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL` |
| Google Workspace | OAuth client id/secret and redirect URI |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| WhatsApp Business | Operator-owned Meta Cloud API credentials |
| MCP | `MCP_API_TOKEN`, `MCP_HTTP_AUTH_TOKEN` |

Extended guide: [docs/self-hosting/docker-compose.md](docs/self-hosting/docker-compose.md).

### [05] Judicial Boundary

The public edition may model public judicial case tracking: querying permitted
sources, normalizing events, preserving source attribution and linking the result
to an Opus case.

It does not publish court filing, pleadings, claims, PQRS, appeals, delegated
credential use, OTP/MFA, captcha, authenticated browser automation, operational
recordings, screenshots or production playbooks.

See:

- [docs/arquitectura/integraciones-judiciales-mcp.md](docs/arquitectura/integraciones-judiciales-mcp.md)
- [docs/operacion/closed-modules.md](docs/operacion/closed-modules.md)

### [06] Development And Validation

```bash
cd backend && npm ci
cd ../frontend && npm ci
cd ../mcp-server && npm ci
```

Checks:

```bash
cd backend && npm audit --omit=dev
cd ../frontend && npm audit --omit=dev && npm run build
cd ../mcp-server && npm audit --omit=dev
```

MCP smoke:

```bash
cd mcp-server
node --input-type=module -e "import('./src/server.js').then(({ createServer }) => { createServer(); console.log('mcp tools registered'); process.exit(0); })"
```

### [07] Custody And Security

Do not publish or commit:

- secrets, tokens, real `.env` files or private keys;
- real client, case, court or third-party data;
- dumps, backups, PDFs, spreadsheets, recordings or operational screenshots;
- judicial credentials or external-provider credentials;
- private production or managed infrastructure configuration.

Report vulnerabilities through the private channel defined in [SECURITY.md](SECURITY.md).

### [08] Contributions

Contributions are welcome for:

- public documentation;
- self-hosting;
- tests and CI;
- self-hosted user experience;
- public judicial case-tracking connectors when the source permits that use;
- generic adapters that do not depend on closed automation.

Before opening a PR, review [CONTRIBUTING.md](CONTRIBUTING.md).

### [09] License And Commercial Use

Opus SC LegalTech is released under a fair-code/source-available license.
Permitted self-hosted internal use is described in [LICENSE](LICENSE).

A separate commercial agreement is required to:

- operate Opus for third parties;
- offer managed hosting;
- resell, sublicense or white-label;
- embed Opus in a commercial product;
- use Opus to build a competing service.

Commercial contact: [COMMERCIAL.md](COMMERCIAL.md).
