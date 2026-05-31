# Security Policy

## Supported Versions

Security fixes are prioritized for the current public release line.

Early public releases may be marked alpha. Alpha releases are suitable for
evaluation and controlled self-hosted use, not for unsupervised production with
sensitive client data unless your team has reviewed and hardened the deployment.

## Reporting a Vulnerability

Please do not open a public GitHub issue for vulnerabilities, secrets, exposed
client data, authentication bypasses, judicial credential risks, or privacy
incidents.

Report privately to:

`admin@sclegaltech.com`

Include:

- affected version or commit;
- affected component;
- reproduction steps;
- expected impact;
- logs or screenshots only if they do not contain sensitive third-party data.

We aim to acknowledge credible reports within 5 business days.

## Scope

In scope:

- authentication and authorization issues;
- data exposure;
- secret handling;
- organization and self-hosted data isolation;
- MCP tool authorization;
- judicial credential handling in public stubs/interfaces;
- dependency vulnerabilities with practical impact.

Out of scope:

- social engineering;
- denial-of-service testing against hosted infrastructure without permission;
- reports requiring access to systems you do not own;
- vulnerabilities in third-party services unless Opus integration code makes
  them exploitable.
