# Closed Modules Boundary

This document defines the public boundary for the self-hosted release.

The public repository is intended to run a single self-hosted Opus SC LegalTech
instance. It does not publish commercial operations, provider-specific
production playbooks, internal process documents, client intake workflows,
payment integrations, real data, or maintained last-mile connectors.

## Excluded From The Public Repository

- Production deployment configuration and managed hosting playbooks.
- Payment-provider integrations and SaaS billing logic.
- Internal onboarding, commercial intake, KYC/SARLAFT and proposal workflows.
- Import pipelines containing real or customer-derived data.
- Public marketing website, blog pages and legal marketing content.
- Private operational checklists and release working documents.
- Real client data, court data, credentials, files, backups, PDFs, spreadsheets,
  recordings or screenshots.
- Authenticated judicial portal automation, credential vaults, filing flows,
  legal-act submission and maintained last-mile judicial connectors.

## Public Judicial Boundary

The public release may expose read-only case-tracking contracts and stubs.
Community contributions may add adapters for public case status lookup when the
source permits that use.

The public release must not include court filing, legal-act submission,
delegated credentials, OTP/MFA handoff, captcha workflows or browser automation
for authenticated judicial portals.

## Published Alternatives

Closed capabilities are represented publicly by one of these mechanisms:

- an interface;
- a stub returning a clear not-implemented response;
- documentation describing the boundary without disclosing implementation;
- a commercial-contact path where a separate agreement is required.
