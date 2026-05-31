# Database

The public self-hosted release uses a clean initial database baseline:

- `schema.sql` creates the local PostgreSQL schema used by Docker.
- `seed.sql` loads synthetic demo users, clients, cases and tasks.

Historical internal migrations are intentionally not published. The public
repository should not expose SaaS billing, payment-provider tables,
multi-tenant commercial operations, private onboarding workflows or internal
release history.

Docker Compose mounts these files into PostgreSQL on first startup:

```bash
docker compose up -d --build
```

To recreate the local database from this baseline:

```bash
docker compose down -v
docker compose up -d --build
```

Do not add real client data, database dumps, backups, court credentials,
spreadsheets or exported production records to this directory.
