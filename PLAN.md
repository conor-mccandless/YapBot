# YapBot v1 Private Beta Implementation Plan

## Status and goal

YapBot v1 is a deliberately small private beta. Its purpose is to prove that the
core Discord behavior is useful, predictable, safe, and inexpensive to operate
before adding a dashboard or any LLM provider.

The first release will:

- Run in 1-3 explicitly approved Discord guilds.
- Watch one configured role in one configured text channel per guild.
- Count qualifying messages in a rolling in-memory window.
- Reply with a built-in static message after the threshold is reached.
- Respect a per-member cooldown.
- Be configured entirely through Discord slash commands.
- Store configuration and metadata in PostgreSQL, but never message content.

This is a private-beta milestone, not the complete mature multi-tenant product.
The web control plane, OAuth, BYOK credentials, LLMs, images, and advanced rule
inheritance are follow-up releases.

## Explicit v1 decisions

These decisions supersede the broader mature specification for the initial
release.

### Product boundary

- There is one Discord application and one worker process.
- The worker may serve multiple guilds, but v1 is operationally limited to 1-3
  approved guild IDs.
- There is no web dashboard, public HTTP API, Discord user OAuth, domain, Caddy,
  or public network port.
- Guild administrators configure YapBot through slash commands.
- v1 uses a built-in, versioned static response pool. It makes no external LLM
  calls and accepts no provider credentials.
- v1 monitors one role and one text channel per guild. Multiple role rules,
  channel lists, user-specific administrator rules, and rule priority are
  deferred.
- Threads are ignored in v1. Thread policy and the
  `SEND_MESSAGES_IN_THREADS` permission will be added together later.

### Discord access

Use Guild Install only.

- Installation scopes: `bot`, `applications.commands`.
- Bot permissions: View Channels, Send Messages, Read Message History.
- Gateway intents: Guilds and Guild Messages.
- Do not request Administrator, Guild Members, Message Content, Manage Roles,
  Manage Messages, or other privileged access.

Message Content is intentionally excluded. v1 needs message author, guild,
channel, timestamp, and the member roles included with a guild message event; it
does not need the message body, embeds, or attachments.

The application owner manually controls which guilds may use the beta through
an `ALLOWED_GUILD_IDS` environment variable. The worker leaves or disables
itself in any unapproved guild.

### Runtime consistency

- Exactly one worker replica is supported.
- Sliding windows and cooldowns live in worker memory and reset on restart.
- PostgreSQL stores guild configuration, command audit events, and metadata-only
  trigger events.
- There is no Redis, queue, `LISTEN/NOTIFY`, distributed lock, or worker-to-web
  API in v1.
- A keyed in-process mutex serializes decisions for each `guildId/userId` pair.
- Each in-memory member entry records its last activity. A periodic sweep removes
  entries after both their rolling window and cooldown have expired, so inactive
  members cannot accumulate indefinitely.
- Disable, setup, and behavior-configuration changes clear the affected guild
  runtime state. Configuration changes therefore take effect with fresh windows
  and cooldowns.
- Deployment must stop the old worker before starting the new worker. Two
  overlapping workers are unsupported because they could produce duplicate
  replies.

This consistency model is adequate for a private beta with static responses. A
future release must introduce durable trigger coordination before allowing
multiple worker replicas.

## User-visible behavior

### Defaults and bounds

Newly configured guilds start disabled.

Defaults:

- Threshold: 15 qualifying messages.
- Sliding window: 300 seconds.
- Cooldown: 600 seconds.
- Ping target: enabled.
- Static response pool: built into the application.

Validation bounds:

- Threshold: 3-100 messages.
- Sliding window: 30-3,600 seconds.
- Cooldown: 0-86,400 seconds.

Custom response text is deferred. Keeping the response pool in code makes the
initial moderation and mention-safety behavior reviewable and deterministic.

### Qualifying message

A message qualifies only when all of the following are true:

- It is a normal guild text-channel message.
- Its guild is present in `ALLOWED_GUILD_IDS`.
- YapBot is enabled and setup is complete for that guild.
- It is in the guild's configured channel.
- The author is a human member, not a bot, webhook, or system user.
- The author's roles include the configured monitored role.

DMs, threads, forum/media posts, webhook messages, bot messages, system
messages, and messages in other channels are ignored.

### Detection and response flow

1. Apply the qualifying-message filters.
2. Enter the keyed mutex for the guild/member pair.
3. Append the event timestamp to the pair's in-memory rolling window.
4. Prune timestamps older than the configured window.
5. Stop if the count is below the threshold.
6. Stop if the pair is in cooldown.
7. Set the cooldown before sending the response.
8. Select a static response using a testable random-selection abstraction.
9. Reply to the triggering message.
10. Record a metadata-only trigger event.

The application constructs the target mention itself. Static response strings
must not contain mentions. Discord `allowed_mentions` permits only the selected
target user and disables role, `@everyone`, and replied-user mentions.

After cooldown expiry, the next qualifying message may trigger again even when
the rolling count remains above the threshold. Restarting the worker clears the
window and cooldown; this is accepted v1 behavior and must be documented.

### Slash commands

Commands are worker-managed and guild-only:

- `/yap setup role:@role channel:#channel` - save the monitored role and text
  channel using the default threshold, window, and cooldown; leave monitoring
  disabled.
- `/yap configure threshold:<n> window-seconds:<n> cooldown-seconds:<n>
ping-target:<boolean>` - update bounded behavior settings.
- `/yap enable` - enable only when setup is complete and the bot can view and
  send in the configured channel.
- `/yap disable` - immediately disable monitoring.
- `/yap status` - show enabled state, configured role/channel, thresholds,
  permission diagnostics, and the number of triggers today.

`setup`, `configure`, `enable`, and `disable` require the guild owner or the
`MANAGE_GUILD` permission. Authorization is taken from the current interaction,
not a cached membership list. `status` is available to ordinary guild members.
All responses are ephemeral where Discord supports it.

Development registers guild-scoped commands in the test guild for immediate
updates. The private beta may continue registering commands per approved guild;
global command registration is not required for v1.

## Data model

Use PostgreSQL with Drizzle ORM and versioned migrations.

### `guild_config`

- `guild_id` primary key.
- `enabled` boolean, default false.
- `setup_complete` boolean, default false.
- `monitored_role_id` nullable Discord snowflake.
- `channel_id` nullable Discord snowflake.
- `threshold` integer.
- `window_seconds` integer.
- `cooldown_seconds` integer.
- `ping_target` boolean.
- `created_at`, `updated_at`.

Application validation and database check constraints enforce the documented
bounds. A guild cannot be enabled unless setup is complete.

### `trigger_event`

- Generated primary key.
- `guild_id`, `user_id`, `channel_id`.
- `message_count` at trigger time.
- `outcome`, initially only `static_response` or `send_failed`.
- `latency_ms`.
- `created_at`.

Trigger events never contain source text, attachment data, or response text.
Retain them for 30 days and delete expired rows with a daily worker maintenance
task.

### `admin_audit_event`

- Generated primary key.
- `guild_id`, `actor_user_id`, command name, and redacted structured change.
- `created_at`.

Retain audit events for 180 days. The change payload may contain configuration
values and Discord IDs but never message content or secrets.

Tables for users, member preferences, sessions, OAuth tokens, provider
credentials, advanced rules, daily LLM usage, and model selection are not part
of the v1 schema.

## Repository structure

Use Node.js 24 LTS, TypeScript, and a `pnpm` workspace.

```text
apps/
  worker/       discord.js Gateway client, commands, maintenance, lifecycle
packages/
  config/       Zod environment validation
  domain/       Qualifying-message rules, detector, cooldown, shared types
  db/           Drizzle schema, repositories, migrations
  discord/      Command definitions and Discord permission helpers
infra/
  compose/      Development and production Compose files
```

Do not create an empty `apps/web` or `packages/llm` merely to match the future
architecture. Add those packages when their release begins.

Core dependencies:

- `discord.js` for Gateway events, interactions, REST, reconnects, and rate
  limits.
- PostgreSQL and Drizzle ORM for durable state.
- Zod for environment and command/configuration validation.
- Pino for structured logs with explicit redaction.
- Vitest for unit and integration tests.
- Testcontainers for repository and migration tests.

Keep domain logic independent of Discord and Drizzle types. Discord event
handlers translate incoming data into small domain inputs; repositories
translate database rows into domain configuration.

## Implementation order in this directory

### Milestone 0 - confirm external setup

Before application code:

- Create the Discord application and a private test guild.
- Enable Guild Install with the documented scopes and minimal permissions.
- Record the application ID, bot token, test guild ID, and approved guild IDs.
- Confirm no privileged intents are enabled.

Secrets stay in local untracked environment files and deployment secrets. They
are never placed in Git or `PLAN.md`.

### Milestone 1 - repository foundation

Initialize Git and create:

- Root workspace and package-manager configuration.
- Locked Node and `pnpm` versions.
- Shared strict TypeScript configuration.
- ESLint/formatting configuration.
- `.env.example` containing names and descriptions, never values.
- Development Compose with PostgreSQL only.
- Initial CI for install, formatting, type-checking, unit tests, and build.

The first commit should be a clean workspace that builds without any Discord or
database feature implementation.

### Milestone 2 - pure domain behavior

Implement and test:

- Qualifying-message filtering inputs.
- Rolling-window append and pruning.
- Threshold and cooldown decisions.
- Keyed mutex behavior.
- Static-response selection abstraction.
- Safe reply construction and allowed-mention policy.

Use a fake clock and deterministic random source in tests. Do not require a live
Discord connection for domain tests.

### Milestone 3 - persistence

Implement:

- Drizzle schema and first migration.
- Guild configuration repository.
- Trigger and audit repositories.
- Daily retention cleanup.
- Migration tests against an empty PostgreSQL database.
- Repository tests proving guild scoping and constraint enforcement.

### Milestone 4 - Discord vertical slice

Implement:

- Environment validation and fail-fast startup.
- Discord client lifecycle and graceful shutdown.
- Approved-guild enforcement.
- Guild-scoped command registration script.
- Setup, configuration, enable/disable, and status commands.
- `messageCreate` handling through the tested domain layer.
- Permission diagnostics and safe static replies.
- Metadata-only logging and database events.

At the end of this milestone, one test guild must work end to end without a web
app or provider account.

### Milestone 5 - production hardening

Add:

- Multi-stage worker image running as a non-root user.
- Pinned production image tag or digest.
- Compose health check, restart policy, resource limit, and shutdown grace
  period.
- Log rotation and secret-field redaction tests.
- Daily encrypted PostgreSQL backup to separate storage.
- Documented restore procedure and one successful restore drill.
- Docker startup and graceful-shutdown smoke tests.

### Milestone 6 - private-beta deployment

Deploy only after the acceptance criteria pass locally:

1. Build the immutable worker image in CI and push it to GHCR.
2. Back up PostgreSQL.
3. Pull the exact image tag on the VPS.
4. Stop the existing worker before migration/startup to prevent overlap.
5. Run migrations as a one-shot command protected by a PostgreSQL advisory
   lock.
6. Start PostgreSQL and the single worker.
7. Verify database connectivity, Gateway readiness, command responses, and
   permission diagnostics.
8. Run the manual test-guild checklist.

## Local and production topology

### Local development

```text
discord.js worker ---> PostgreSQL in Docker
        |
        +------------> Discord Gateway and REST
```

The worker may run directly on the developer machine for fast reloads while
PostgreSQL runs in Compose.

### Private-beta production

```text
discord.js worker ---> PostgreSQL
        |
        +------------> Discord Gateway and REST
```

Both services run on one small VPS through Docker Compose. No application port
is public. PostgreSQL binds only to the internal Compose network. A 1 vCPU/2 GB
host is an acceptable beta floor; 2 vCPU/4 GB is preferred for operational
headroom.

Production requirements:

- Exact image tags; never deploy `latest`.
- One worker replica.
- Persistent PostgreSQL volume.
- Only SSH is exposed for administration.
- Daily encrypted off-host backups.
- Local JSON log rotation without message content.
- Bot token supplied as a runtime secret.
- Host monitoring for disk, memory, container restarts, and backup failure.

An SSH-based protected GitHub Actions deployment may be added for v1, but a
documented manual deployment is acceptable for the first private-beta rollout.
Application behavior is more important than automating an infrequent deployment
too early.

## Test plan

### Automated tests

- Sliding-window boundary, pruning, sustained traffic, and cooldown expiry.
- Periodic eviction of inactive in-memory member state.
- Messages immediately before and at the threshold.
- Member with and without the configured role.
- Wrong guild, wrong channel, DM, thread, bot, webhook, and system-message
  filtering.
- One decision at a time for the same guild/member pair.
- Independent state for different guilds and members.
- Configuration bounds and incomplete-setup enable rejection.
- Guild owner/`MANAGE_GUILD` command authorization.
- Static pool selection and deterministic tests.
- Mention suppression and controlled target mention.
- Cross-guild repository access denial.
- Metadata events containing no message or response content.
- Empty-database migration and retention cleanup.
- Graceful shutdown and Docker startup smoke tests.

### Manual test-guild checklist

- Install the bot with only the requested permissions and standard intents.
- Confirm an unconfigured or disabled guild is inert.
- Run setup and confirm monitoring remains disabled.
- Enable and trigger the threshold in the configured channel.
- Confirm other roles and channels are ignored.
- Confirm only the target can be mentioned.
- Reconfigure or disable/re-enable and confirm stale windows do not survive.
- Confirm cooldown prevents duplicate responses.
- Restart the worker and confirm windows/cooldowns reset as documented.
- Remove Send Messages or View Channel and confirm enable/status diagnostics.
- Attempt an administrator command without `MANAGE_GUILD` and confirm denial.
- Inspect the database and logs to confirm no message content was retained.

## v1 acceptance criteria

The private beta is ready when:

- The automated test suite passes from a clean checkout.
- One Discord test guild completes the manual checklist.
- The worker runs for seven consecutive days without duplicate triggers,
  unbounded memory growth, or content/secret leakage.
- A second approved guild can be configured without code changes or a separate
  deployment.
- Backup and restore have both been demonstrated.
- Installation, environment variables, local setup, deployment, rollback,
  privacy behavior, and troubleshooting are documented in `README.md`.

The v1 release does not depend on a dashboard, OAuth, a domain, HTTPS, provider
credentials, or successful LLM calls.

## Follow-up release roadmap

Each release should remain usable and testable on its own. Do not start a later
release until v1 behavior is stable.

### v1.1 - private-beta targeting and owner-funded OpenAI (implemented)

- Exactly one monitored target mode per guild: either one role or an individual user list with add/remove/list commands.
- Administrator-managed per-user persona descriptions used only as request-time
  dry-humor context, with set/show/clear commands and audit metadata.
- Bounded trigger context (current message count, configured threshold, and
  rolling-window duration) supplied to the model, which must combine a
  context-specific joke with a playful anti-yap nudge.
- One deployment-owned OpenAI project key supplied through `.env`; no guild BYOK.
- The latest threshold-sized set of qualifying messages, ordered oldest to newest,
  plus at most three recent eligible Discord images from the same member's rolling
  window are transmitted, with no persisted message or image context.
- Persona descriptions are persisted until cleared; message bodies and generated
  responses are never persisted by YapBot.
- One configured default model with an optional image-request model override,
  provider deadline, one bounded retry, static fallback, mention neutralization,
  and output truncation.
- PostgreSQL conditional reservation for a daily per-guild generation-attempt cap.
- Message Content intent is requested only when the OpenAI key is present.
- No dashboard, text conversation history, image generation, multiple providers,
  or per-guild model selection.
- Image input is limited to validated PNG/JPEG/WEBP Discord attachments, bounded
  in memory and at download/request time, with static fallback on failure.

This is appropriate for the approved private-beta guild list. Before the bot is
opened to untrusted guilds, replace the shared environment key with scoped,
encrypted guild credentials or an explicit owner-funded product policy.

### v1.2 - richer Discord configuration

- Multiple allowed standard text channels (implemented; up to 25, with
  add/remove/list commands and same-channel replies).
- Multiple monitored roles using one shared behavior configuration.
- Member opt-out/opt-in commands and administrator-created user exclusions.
- Custom static fallback pool with validation and audit history.
- Thread support plus `SEND_MESSAGES_IN_THREADS`.
- Persisted last-trigger time if restart cooldown behavior proves noisy.

### v1.3 - minimal web control plane

- Next.js web application in a separate runtime/image.
- Discord OAuth with `identify` and `guilds` only.
- Guild picker intersected with installed guilds.
- Permission revalidation for sensitive writes.
- Setup/status/configuration pages.
- Optimistic configuration versions and redacted audit diffs.
- PostgreSQL `LISTEN/NOTIFY` through a dedicated connection for worker cache
  invalidation, with TTL recovery.

Do not add provider credentials in the same release as the first OAuth control
plane unless the dashboard is already stable.

### v1.4 - production LLM credential and context upgrade

- Encrypted guild-owned credentials with versioned key rotation.
- Promote the current OpenAI integration behind a reusable provider adapter.
- Curated text-model catalog.
- Optional richer conversation context involving other participants, requiring a
  separate privacy and product review. The current implementation includes only
  the triggering member's threshold-sized message set.
- Daily generation quota with PostgreSQL conditional reservation.
- Provider deadline, bounded retry behavior, static fallback, and deterministic
  output word truncation.
- No images and no automatic provider failover.

Clarify and test whether quota counts attempts or successful generations before
implementation. Provider transmission and retention behavior must be disclosed
separately from YapBot's own no-content-retention policy.

### v1.5 - advanced rules and additional providers

- Guild defaults, ordered role rules, and user overrides.
- Deterministic guild -> highest-priority role -> user precedence.
- User-level credential/model selection.
- Anthropic, OpenAI, and xAI adapters behind one tested contract.
- Provider/model capability validation and usage views.

### v1.6 - advanced image context and generation

- Explicit guild-level image-context controls beyond the deployment-level private
  beta disclosure.
- GIF animation inspection and additional safe attachment formats.
- Optional image generation as a separate, quota-controlled output feature.
- Per-model capability validation and image-specific usage reporting.

### v2 - scale and infrastructure evolution

- Durable trigger idempotency and coordination for multiple worker replicas.
- Discord sharding when guild count requires it.
- ECS/Fargate or another orchestrator only when VPS operations become a real
  constraint.
- Managed PostgreSQL, Secrets Manager/KMS, and infrastructure as code.
- Formal privacy/export/deletion tooling if the product becomes publicly
  listed.

## Deferred mature architecture principles

The following principles from the original mature specification remain valid
for later releases:

- Keep the web control plane and Gateway worker as separate runtimes.
- Share domain, database, validation, Discord, and LLM packages in one
  TypeScript monorepo.
- Tenant-scope every database operation by guild.
- Never expose bot tokens, OAuth tokens, or provider credentials to the browser.
- Never persist Discord source text, images, or generated output in trigger
  history.
- Prefer static fallback over silently spending through another provider.
- Use immutable images and backward-compatible database migrations.
- Preserve a path to managed infrastructure without introducing its cost and
  complexity before it is needed.

Design reference: [original shared chat](https://chatgpt.com/share/6a7ac134-2578-83e8-8f56-ed6717568f55).
