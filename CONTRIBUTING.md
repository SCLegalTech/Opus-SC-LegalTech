# Contributing

Thanks for your interest in Opus.

This project is fair-code/source-available. Contributions are welcome when they
fit the public self-hosted edition and do not expose closed filing/submission
connectors, client data, production infrastructure, or confidential operational
knowledge.

## Before Opening a PR

- Open an issue first for large features or behavioral changes.
- Keep PRs small and reviewable.
- Include tests or smoke steps when behavior changes.
- Do not commit `.env` files, secrets, recordings, PDFs, spreadsheets, backups,
  client data, judicial credentials, or production provider configuration.
- Judicial integration PRs are welcome when they focus on lawful case tracking,
  public docket/status lookup, public court data normalization, or MCP tools that
  run with the self-hoster's own authorized access.
- Do not add court filing/radicacion, submission workflows, legal-act execution,
  payment-provider flows, credential harvesting, bypasses, or private production
  provider configuration to the public edition.

## Good Contribution Areas

- self-hosted documentation;
- Docker and setup improvements;
- public MCP tools;
- UI fixes;
- accessibility;
- tests and CI hardening;
- generic integrations that use the self-hoster's own credentials;
- public case-tracking and court-information connectors;
- adapter interfaces and safe stubs.

## License of Contributions

Unless a separate written agreement says otherwise, contributions are submitted
under the repository license and may be used by Smart Crypto Legal S.A.S. in the
self-hosted and commercial editions of Opus.

## Support Expectations

Community support is best-effort. Official support, hosted operations, enterprise
integrations, managed judicial connectors, and filing/radicacion capabilities are
commercial offerings unless expressly opened in this repository.
