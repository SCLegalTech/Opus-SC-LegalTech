# Judicial Case Tracking via MCP

**Status:** public self-hosted boundary

This release exposes only the public, read-only side of judicial integrations:
case tracking, timeline normalization, source attribution, and audit records.

It does not publish court filing, legal-act submission, delegated judicial
credentials, browser automation, OTP/MFA handoff, or maintained last-mile
connectors.

## Public Scope

Self-hosted operators may implement adapters that:

- query public case status when the source permits it;
- normalize procedural events into an internal timeline;
- link an external process number to an Opus case;
- store source URLs, timestamps, and evidence of the lookup;
- keep every lookup auditable and attributable to a user or service account.

## Out of Scope

The public repository must not include:

- filing or submission flows;
- memorial, claim, PQRS, appeal, or legal-act automation;
- credential vaults for judicial portals;
- Playwright scripts for authenticated court portals;
- OTP, MFA, captcha, or human handoff for external submission;
- production playbooks for maintained SC LegalTech connectors.

## MCP Contract

The public MCP contract is intentionally narrow:

| Tool | Purpose |
| --- | --- |
| `judicial_case_tracking_platforms` | List case-tracking adapter slots. |
| `judicial_case_tracking_lookup` | Look up public case status through an operator adapter. |
| `judicial_case_tracking_link` | Link a public tracking result to an Opus case. |

These tools are stubs by default. They define where community contributions may
attach read-only adapters without crossing into legal-act execution.

## Contribution Rule

Contributions are welcome for public case tracking connectors, parsers,
normalizers, and documentation. Contributions that implement filing,
submission, delegated credential use, or authenticated portal automation should
not be submitted to the public repository.
