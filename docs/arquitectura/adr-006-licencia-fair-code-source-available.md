# ADR-006: Fair-Code Source-Available Public Release

Status: Approved on 2026-05-29

Approver: Smart Crypto Legal S.A.S.

## Context

Opus SC LegalTech is distributed as a public self-hosted repository so legal
teams can inspect, run and adapt the software for permitted internal use.

The project also includes commercial value in hosted operations, maintained
connectors, support, compliance work and managed deployments. The public license
must therefore permit self-hosted use while reserving commercial uses that would
compete with the hosted or enterprise offering.

## Decision

Adopt a fair-code, source-available licensing model for the public self-hosted
release.

The public repository may include:

- self-hosted application code;
- local setup and Docker configuration;
- public MCP tool contracts;
- stubs and interfaces for optional integrations;
- documentation required to run and contribute to the public edition.

The public repository does not include closed commercial operations, private
deployment playbooks, payment-provider implementation, production data,
maintained last-mile judicial connectors, or filing/submission automation.

## License Boundary

The final `LICENSE` text must be reviewed by counsel before the repository is
made public. This ADR approves the product and business-model direction; it is
not a substitute for legal review of the license text.

## Consequences

- The public repository can be inspected and self-hosted under the published
  license terms.
- Commercial hosting, resale, white-label operation, or competing managed
  services require a separate commercial agreement.
- Contributions to the public edition are accepted under the repository license.
- Closed modules remain outside the public repository and are documented only at
  the boundary level.
