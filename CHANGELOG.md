# Changelog

All notable changes to YapBot are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-26

### Added

- Opt-in direct Discord questions through bot mentions and replies, with bounded
  same-channel history, explicit reply evidence, exact participant resolution,
  multiple subjects, personas, and secure image context.
- Per-guild direct settings under `/yap configure` for enablement, requester
  cooldown, and a 1–1,440-minute context window; `/yap status` reports them.
- Independent direct-request quotas, in-flight protection, a guild guard, output
  budgets, fallbacks, and structured diagnostics without persistent chat history.
- Additive database migrations for direct settings and the three-hour default,
  plus PostgreSQL integration coverage in CI and comprehensive routing, context,
  command, generation, and media regression tests.
- Optional prompt and rejected-response diagnostic logging for model tuning.

### Changed

- Direct context now defaults to three hours while remaining capped at 40 human
  messages, 20,000 content characters, three images, and one Discord history page.
- Direct answers use their own prompt and token budget and may contain up to 150
  words / 1,200 characters without passive slowdown or sentence requirements.
- Passive responses use more varied trigger phrasing, recognize contextual
  slowdown commands, and apply less brittle completion and sentence validation.
- Passive trigger bursts are consumed after a response to prevent repeated roasts
  from the same already-counted messages.
- Container health checks now probe PID 1 directly, working without a Node runtime
  process probe inside the worker health command.

### Fixed

- Refresh delayed Discord attachment and embed previews before image collection,
  with bounded source-message fetching and clear unavailable-image context.
- Recognize managed bot role mentions as direct addresses.
- Accept valid quoted statements and quoted questions without miscounting sentence
  boundaries or leaking passive validation rules into direct responses.

## [0.2.0] - 2026-08-15

### Added

- Multiple individually monitored users and combined monitored-role targeting.
- Full ordered conversation windows, Discord attachment/link image context, and
  relevance-based per-user persona callbacks for generated replies.

### Changed

- Refined conversational prompting, visual-context priority, response routing,
  completion handling, mention safety, and anti-yap correction language.

## [0.1.0] - 2026-08-12

### Added

- Initial private-beta Discord worker with PostgreSQL-backed guild configuration,
  threshold-based anti-yap replies, optional OpenAI generation, personas, quotas,
  slash commands, and local Compose deployment.

[unreleased]: https://github.com/conor-mccandless/YapBot/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/conor-mccandless/YapBot/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/conor-mccandless/YapBot/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/conor-mccandless/YapBot/releases/tag/v0.1.0
