# YapBot

YapBot is a private-beta Discord bot that watches one configured user or role across one or more configured standard text channels. When a matching member reaches a rolling message threshold, YapBot posts a dry, context-aware anti-yap reply in the channel that triggered it.

OpenAI generation is optional. With an API key, YapBot can use the complete ordered threshold-sized message context, recent eligible images, trigger metadata, and a per-user persona to generate its reply. Without an API key—or when generation fails or reaches its daily limit—it uses a built-in static response pool.

See [PLAN.md](./PLAN.md) for the release boundaries and follow-up roadmap.

## Current behavior

- One monitored target per Discord server: either one role or one specific user.
- Between 1 and 25 monitored standard text channels per server.
- Independent rolling counters and cooldowns per member.
- Counts are shared across configured channels. Two messages in one configured channel and one in another can satisfy a threshold of three.
- Replies are posted in the configured channel containing the triggering message.
- Optional administrator-managed persona for each individual user, including members of a monitored role.
- Optional OpenAI text and image understanding using the latest threshold-sized set of qualifying messages, ordered oldest to newest, and up to three recent eligible images from the same member.
- Usually one sharp, direct 8-28 word reply, with up to 45 words when conversation, persona, or image context genuinely improves the joke.
- PostgreSQL persistence for guild configuration, personas, quotas, audit metadata, and trigger metadata.
- In-memory message timestamps, bounded message text, image references, and cooldowns; these reset when the worker restarts or configuration changes.
- One worker replica. Do not run multiple workers against the same Discord application.
- No voice-channel monitoring, voice transcription, voice-channel chat, threads, image generation, or dashboard.
- No Discord message text, image bytes/URLs, or generated response text stored in YapBot's database or application logs.

## Repository layout

```text
apps/worker/          Discord worker and OpenAI response generation
assets/               Discord profile and banner artwork
infra/compose/        Local/private-beta Compose deployment
packages/config/      Environment validation
packages/db/          PostgreSQL schema, repository, and migrations
packages/discord/     Discord intents, permissions, and slash commands
packages/domain/      Rolling-window and cooldown behavior
```

## Prerequisites

Choose one container runtime:

- Podman 5 or newer, a running Podman machine, and a Compose provider; or
- Docker Desktop with Docker Compose.

For host development, also install:

- Node.js 24 LTS (`>=24.14.0 <25`).
- pnpm 11.16.0.

You also need:

- A Discord account and private test server you administer.
- A Discord application and bot token.
- An OpenAI project API key if you want generated replies and image understanding. The bot works with static responses if the key is omitted.

## Discord application setup

Open the [Discord Developer Portal](https://discord.com/developers/applications), then complete the following steps.

### 1. Create the application and bot

1. Select **New Application**, name it `YapBot`, and create it.
2. On **General Information**, copy the **Application ID** for `DISCORD_APPLICATION_ID`.
3. Upload the repository artwork if desired:
   - `assets/yapbot-profile.png` for the application or bot profile.
   - `assets/yapbot-banner.png` for the application banner.
4. Open **Bot** and create the bot user if Discord has not already created it.
5. Select **Reset Token**, copy the new token once, and store it as `DISCORD_TOKEN` in `.env`.

Never commit, post, or send the bot token. If it is exposed, reset it immediately in the Developer Portal and replace the value in `.env`.

### 2. Configure gateway intents

On the **Bot** page under **Privileged Gateway Intents**:

- Enable **Message Content Intent** when `OPENAI_API_KEY` is configured. Discord restricts message content and attachment fields without this intent.
- Leave **Server Members Intent** disabled.
- Leave **Presence Intent** disabled.

YapBot requests Message Content Intent only when an OpenAI key is present. The standard Guilds and Guild Messages intents require no portal toggle. See Discord's [Gateway Intents documentation](https://docs.discord.com/developers/events/gateway#gateway-intents).

### 3. Configure installation

Open **Installation** in the Developer Portal:

1. Enable **Guild Install**. YapBot does not use User Install.
2. Use the Discord-provided install link.
3. Under the Guild Install defaults, select these scopes:
   - `bot`
   - `applications.commands`
4. Select only these bot permissions:
   - **View Channels**
   - **Send Messages**
   - **Read Message History**

The combined permission integer is `68608`. YapBot does not need Administrator, Manage Messages, Manage Roles, or voice permissions. Discord documents server-installed applications and install links in its [Application Resource documentation](https://docs.discord.com/developers/resources/application#installation-context).

Copy the install link, open it, choose your test server, and authorize the application. Installing a server application requires the person installing it to have **Manage Server**.

### 4. Copy the test server ID

In Discord desktop:

1. Open **User Settings > Advanced**.
2. Enable **Developer Mode**.
3. Right-click the server icon and select **Copy Server ID**.
4. Use that value for `ALLOWED_GUILD_IDS`.

Discord's [ID guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID) includes desktop and mobile instructions.

## OpenAI setup

OpenAI is optional. Leave `OPENAI_API_KEY` blank to use only static YapBot replies.

To enable generated replies:

1. Sign in to the [OpenAI API dashboard](https://platform.openai.com/).
2. Select or create the project that will fund YapBot.
3. Create a project API key.
4. Put the key only in the local `.env` file as `OPENAI_API_KEY`.
5. Set project budgets and usage limits appropriate for the test server.

The official [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart) recommends keeping the API key in an environment variable. Do not put it in source code or commit it to Git.

The default `gpt-5.6-luna` model is intended for cost-sensitive workloads and supports text and image input. `gpt-5.6-terra` is a higher-cost balance of capability and price, while `gpt-5.6-sol` prioritizes capability. Confirm current availability for your project in the [OpenAI model catalog](https://developers.openai.com/api/docs/models).

## Environment configuration

Copy the example file from the repository root:

```powershell
Copy-Item .env.example .env
```

Populate `.env`:

```dotenv
DISCORD_TOKEN=replace-with-current-bot-token
DISCORD_APPLICATION_ID=replace-with-application-id
ALLOWED_GUILD_IDS=replace-with-test-server-id

OPENAI_API_KEY=replace-with-openai-project-api-key
OPENAI_MODEL=gpt-5.6-luna
OPENAI_IMAGE_MODEL=
OPENAI_REASONING_EFFORT=low
OPENAI_DAILY_GUILD_LIMIT=100
OPENAI_MAX_OUTPUT_TOKENS=900
OPENAI_TIMEOUT_MS=10000

DATABASE_URL=postgresql://yapbot:yapbot_dev@localhost:5432/yapbot
LOG_LEVEL=info
NODE_ENV=development
```

### Environment variable reference

| Variable                   | Required    | Description                                                                                         |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`            | Yes         | Current secret token from the Discord **Bot** page.                                                 |
| `DISCORD_APPLICATION_ID`   | Yes         | Application ID from **General Information**.                                                        |
| `ALLOWED_GUILD_IDS`        | Yes         | Comma-separated list of approved Discord server IDs. At least one is required.                      |
| `OPENAI_API_KEY`           | No          | Owner-funded OpenAI project key. Blank enables static responses only.                               |
| `OPENAI_MODEL`             | With OpenAI | Model for text-only and, by default, image-bearing requests.                                        |
| `OPENAI_IMAGE_MODEL`       | No          | Optional separate model for requests containing images. Blank uses `OPENAI_MODEL`.                  |
| `OPENAI_REASONING_EFFORT`  | No          | `none`, `low`, `medium`, `high`, `xhigh`, or `max`; default is `low`.                               |
| `OPENAI_DAILY_GUILD_LIMIT` | No          | Maximum reserved generation attempts per server per UTC day, from 1-10,000; default is 100.         |
| `OPENAI_MAX_OUTPUT_TOKENS` | No          | Provider output budget from 32-1,000; default is 900. YapBot rejects visible replies over 45 words. |
| `OPENAI_TIMEOUT_MS`        | No          | OpenAI request deadline from 1,000-60,000 ms; default is 10,000.                                    |
| `DATABASE_URL`             | Yes         | Host-development PostgreSQL URL. Compose overrides it inside the worker container.                  |
| `LOG_LEVEL`                | No          | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`; default is `info`.                           |
| `NODE_ENV`                 | No          | `development`, `test`, or `production`. Compose sets the worker to `production`.                    |

`.env` and other local secret files are ignored by Git. Verify that with `git status --short` before committing.

## Install and run with Podman

### 1. Start Podman

On Windows, initialize a Podman machine once if one does not already exist:

```powershell
podman machine init
```

Start it after login or reboot:

```powershell
podman machine start
podman info
```

### 2. Install a Compose provider

`podman compose` delegates to a Compose provider. Install `podman-compose` with one of these methods:

```powershell
pipx install podman-compose
```

or:

```powershell
python -m pip install --user podman-compose
```

Open a new PowerShell window if the executable was added to `PATH`, then verify it:

```powershell
podman compose version
```

This working directory may also contain an ignored local provider under `.tools/podman-compose`. It is not committed to Git and should not be assumed to exist on a fresh clone.

### 3. Build and start YapBot

From the repository root:

```powershell
podman compose -f infra/compose/compose.dev.yml --profile worker up --build -d
podman compose -f infra/compose/compose.dev.yml --profile worker ps
podman compose -f infra/compose/compose.dev.yml logs --tail 100 worker
```

The worker waits for PostgreSQL, applies pending migrations automatically, connects to Discord, and registers guild-scoped slash commands for every server in `ALLOWED_GUILD_IDS`.

Successful startup includes these log messages:

```text
PostgreSQL connection ready
Discord worker ready
Registered guild commands
```

## Install and run with Docker

Install Docker Desktop and verify Compose:

```powershell
docker version
docker compose version
```

Then run:

```powershell
docker compose -f infra/compose/compose.dev.yml --profile worker up --build -d
docker compose -f infra/compose/compose.dev.yml --profile worker ps
docker compose -f infra/compose/compose.dev.yml logs --tail 100 worker
```

Use the same `.env` file and Discord configuration as the Podman deployment.

## Deployment lifecycle

The provided Compose file is suitable for local use and a private beta on a trusted, always-on host. The bot is offline whenever the PC, container runtime, Podman machine, or worker is stopped. A public deployment should add dedicated production secrets, backups, monitoring, and a production-specific Compose or orchestrator configuration.

### View status and logs

Podman:

```powershell
podman compose -f infra/compose/compose.dev.yml --profile worker ps
podman compose -f infra/compose/compose.dev.yml logs --tail 100 worker
podman compose -f infra/compose/compose.dev.yml logs -f worker
```

Docker uses the same commands with `docker compose`.

### Restart the worker

```powershell
podman restart yapbot-dev_worker_1
```

The exact container name can differ by Compose provider. Run `podman ps -a` first if necessary.

### Stop without deleting data

```powershell
podman compose -f infra/compose/compose.dev.yml --profile worker down
```

This removes the containers and network but preserves the named PostgreSQL volume. Do **not** add `-v` unless you intentionally want to delete the database.

### Start again

```powershell
podman machine start
podman compose -f infra/compose/compose.dev.yml --profile worker up -d
```

### Deploy source-code updates

After pulling or editing code, rebuild and recreate the containers without deleting volumes:

```powershell
podman compose -f infra/compose/compose.dev.yml --profile worker down
podman compose -f infra/compose/compose.dev.yml --profile worker up --build -d
podman compose -f infra/compose/compose.dev.yml logs --tail 100 worker
```

Pending database migrations run during worker startup. Check the worker logs before testing Discord commands.

### Database persistence

PostgreSQL uses the named volume `yapbot-dev_postgres-data`. It survives normal PC shutdowns, Podman machine restarts, container recreation, and `compose down` without `-v`.

It is persistent local storage, not an off-device backup. Data can still be lost by:

- Running `compose down -v`.
- Removing the named volume manually.
- Resetting or deleting the Podman machine.
- Losing or corrupting the host disk.

Inspect the volume with:

```powershell
podman volume inspect yapbot-dev_postgres-data
```

## Discord server configuration

All configuration is server-scoped and stored in PostgreSQL. Command confirmations are ephemeral and visible only to the command user; threshold-triggered YapBot replies are public in the triggering channel.

The server owner or a member with **Manage Server** can run administrative commands. `/yap status` and `/yap channels` are available to other server members.

### Recommended initial setup

1. Check connectivity:

   ```text
   /yap status
   ```

2. Choose exactly one target type and an initial standard text channel:

   ```text
   /yap setup channel:#general role:@Yappers
   ```

   or:

   ```text
   /yap setup channel:#general user:@TestUser
   ```

3. Add additional standard text channels:

   ```text
   /yap channel-add channel:#memes
   /yap channel-add channel:#off-topic
   /yap channels
   ```

4. Configure a short test window:

   ```text
   /yap configure threshold:3 window-seconds:30 cooldown-seconds:30 ping-target:true
   ```

5. Add personas for individual users if desired:

   ```text
   /yap persona-set user:@Alice description:Alice works at a library and once overheard a conversation about the topic, making her the self-appointed expert.
   /yap persona-set user:@Bob description:Bob watched half of one documentary and has treated the subject as his academic specialty ever since.
   ```

6. Enable monitoring:

   ```text
   /yap enable
   ```

7. Have a configured user—or a human member of the configured role—send three eligible messages within 30 seconds in any configured channel.
8. Confirm one reply appears in the channel containing the third message.
9. Repeat with a second user to verify that counters, cooldowns, and personas are user-specific.
10. Send messages from a user outside the role and in an unconfigured channel; both should be ignored.

Running `/yap setup` again replaces the target and entire channel list with the new initial channel, disables monitoring, and clears in-memory runtime state. Add the desired channels again before running `/yap enable`.

## Slash-command reference

### Setup and status

| Command                                  | Permission             | Behavior                                                                                                                                             |
| ---------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/yap setup channel:#channel role:@role` | Owner or Manage Server | Watches the selected role in the initial text channel. Replaces previous setup, resets the channel list, and leaves monitoring disabled.             |
| `/yap setup channel:#channel user:@user` | Owner or Manage Server | Watches one human user instead of a role. Exactly one of `role` or `user` must be supplied.                                                          |
| `/yap status`                            | Any server member      | Shows enabled state, target, all monitored channels, threshold, window, cooldown, mention behavior, daily trigger count, and permission diagnostics. |
| `/yap enable`                            | Owner or Manage Server | Validates bot permissions in every configured channel, enables monitoring, and clears runtime counters.                                              |
| `/yap disable`                           | Owner or Manage Server | Stops monitoring immediately and clears runtime counters. Stored setup and personas remain.                                                          |

### Channel management

| Command                                | Permission             | Behavior                                                                                                        |
| -------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/yap channel-add channel:#channel`    | Owner or Manage Server | Adds a standard text channel after checking View Channel, Send Messages, and Read Message History. Maximum: 25. |
| `/yap channel-remove channel:#channel` | Owner or Manage Server | Removes a monitored text channel. The final remaining channel cannot be removed.                                |
| `/yap channels`                        | Any server member      | Lists all monitored text channels and the current count.                                                        |

Adding or removing a channel clears current rolling counters, cooldowns, recent in-memory message text, and image references. It does not disable monitoring.

### Trigger behavior

```text
/yap configure threshold:<3-100> window-seconds:<30-3600> cooldown-seconds:<0-86400> ping-target:<true|false>
```

The command is restricted to the owner or members with **Manage Server**. Every option is optional, but at least one must be provided.

| Option             | Default after first setup | Description                                                                      |
| ------------------ | ------------------------- | -------------------------------------------------------------------------------- |
| `threshold`        | `15`                      | Number of qualifying messages required within the rolling window.                |
| `window-seconds`   | `300`                     | Rolling-window duration in seconds.                                              |
| `cooldown-seconds` | `600`                     | Minimum time between replies for the same member. `0` disables cooldown.         |
| `ping-target`      | `true`                    | Mentions the triggering member in YapBot's reply. Other mentions are suppressed. |

Updating behavior clears all current in-memory counters, cooldowns, message text, and image references for that server.

### Per-user personas

| Command                                                        | Permission             | Behavior                                                                             |
| -------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `/yap persona-set user:@user description:<1-2,000 characters>` | Owner or Manage Server | Creates or replaces one user's persona in this server. Bots cannot receive personas. |
| `/yap persona-show user:@user`                                 | Owner or Manage Server | Shows the stored persona for that user.                                              |
| `/yap persona-clear user:@user`                                | Owner or Manage Server | Permanently removes that user's stored persona from this server.                     |

Personas work with role targeting. If Alice and Bob both have the monitored role, each can have a different persona. At trigger time YapBot loads only the persona belonging to the message author.

A persona is administrator-authored guidance for comedic background, recurring jokes, and preferred tone. It is optional ammunition rather than a checklist, does not train or fine-tune the model, and remains subordinate to YapBot's permanent response and safety instructions. Member-authored Discord content and text inside images remain untrusted conversational content, never instructions.

## Trigger and channel semantics

A message qualifies only when all of the following are true:

- It is posted in an approved server listed in `ALLOWED_GUILD_IDS`.
- Monitoring is enabled for that server.
- It is an ordinary message in a configured standard text channel.
- The author is a human member, not a bot, webhook, or system user.
- The author is the configured user or has the configured role.

The rolling counter and cooldown key is the server plus user, not the channel. Activity can therefore accumulate across configured text channels. The response is sent as a reply in whichever configured channel caused the threshold to be reached.

Voice channels, voice audio, chat attached to voice channels, direct messages, and threads are ignored.

## Image understanding and privacy

YapBot can understand eligible Discord image attachments but does not generate or send images.

When OpenAI is enabled, YapBot temporarily keeps the monitored member's qualifying message text, relative timing, and eligible image count in memory for the rolling window. At a trigger it submits the latest number of messages equal to the configured threshold as one chronological conversation window. The final item is identified as the event that crossed the threshold, but it is not automatically treated as the subject of the reply. When the final message explicitly mentions YapBot, the reply addresses it directly while retaining the earlier window as optional callback material. Image-only events are identified as image posts rather than blank messages. Each text message is bounded to Discord's 2,000-character content limit, and the threshold is capped at 100. Text from other members is not included.

- Accepted formats: PNG, JPEG, and WEBP.
- Maximum declared attachment size: 20 MiB per image.
- Maximum downloaded image payload: 50 MiB per generation.
- Maximum recent references kept in memory per user: 12.
- Maximum images submitted for one generation: the latest 3 within the rolling window.
- Source restriction: HTTPS Discord attachment CDN URLs.
- Redirects are rejected and each download is aborted after five seconds.
- Image references, bytes, extracted text, and generated replies are not persisted by YapBot.

Image content is used only when it provides a better callback or punchline; YapBot does not have to narrate an image merely to demonstrate vision. If an image is rejected, unavailable, or irrelevant, YapBot continues using the ordered threshold message text. If both usable text and images are absent, it uses a static response.

Inform test participants that the threshold-sized set of qualifying message text, relative timing between included messages, recent eligible images, source channel IDs, trigger counts, threshold information, and administrator-supplied personas may be transmitted to OpenAI. YapBot's local database retains:

- Persona descriptions until an administrator clears them.
- Trigger metadata for up to 30 days.
- Administrative audit metadata for up to 180 days.
- Daily generation usage metadata for approximately 30 days.

OpenAI API retention and data controls are governed separately by the OpenAI project settings and the [official OpenAI data-controls documentation](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).

## Host-development workflow

Install dependencies:

```powershell
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
```

Start PostgreSQL only, apply migrations, validate the repository, and run the worker on the host:

```powershell
podman compose -f infra/compose/compose.dev.yml up -d postgres
pnpm db:migrate
pnpm check
pnpm build
pnpm dev:worker
```

The development worker loads the root `.env`. Do not run the host worker at the same time as the Compose worker; both would log in as the same Discord bot.

Validation commands:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Database inspection

Find the PostgreSQL container name:

```powershell
podman ps --format "table {{.Names}}\t{{.Status}}"
```

Open `psql`:

```powershell
podman exec -it yapbot-dev_postgres_1 psql -U yapbot -d yapbot
```

Useful read-only queries:

```sql
select * from guild_config;
select guild_id, channel_id, created_at from guild_channel order by created_at;
select guild_id, user_id, updated_at from user_persona order by updated_at;
select guild_id, user_id, channel_id, message_count, outcome, latency_ms, created_at
from trigger_event order by created_at desc limit 20;
select * from llm_daily_usage order by usage_date desc;
select filename, applied_at from yapbot_schema_migration order by filename;
```

Message content and generated replies cannot be exposed by these queries because the database schema has no columns for them.

## Put the repository on GitHub

This directory is initialized as a Git repository. Before the first push:

```powershell
git status --short
git add .
git commit -m "Initial YapBot implementation"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

The real `.env`, dependencies, local Podman Compose tooling, build output, and logs are ignored. Never use `git add -f .env`.

## Troubleshooting

### Bot is offline

- Confirm the container runtime and worker are running.
- Run `podman logs --tail 100 yapbot-dev_worker_1`.
- Confirm `DISCORD_TOKEN` contains the current token and was not revoked.
- Rebuild after changing `.env` so the worker container is recreated.

### `/yap` does not appear

- Confirm the application was installed with `bot` and `applications.commands` scopes.
- Confirm the server ID is present in `ALLOWED_GUILD_IDS`.
- Check the worker log for `Registered guild commands` or registration errors.
- Restart Discord if the client has cached the command list.

### Slash command says YapBot could not complete it

- Inspect worker logs for the command name and underlying error.
- Confirm PostgreSQL is healthy and all migrations ran.
- Verify the command was used inside an approved server, not a DM.

### Enable or channel-add fails

Grant YapBot all three required permissions in every configured channel:

- View Channel
- Send Messages
- Read Message History

Channel-specific permission overrides can deny a permission even when the server role grants it.

### OpenAI always uses a static fallback

- Confirm `OPENAI_API_KEY` is populated without printing it.
- Enable Message Content Intent on the Discord **Bot** page.
- Recreate the worker after changing `.env`.
- Confirm startup logs show `openAIEnabled: true`.
- Check project billing, model access, rate limits, and `OPENAI_DAILY_GUILD_LIMIT`.

### Images are ignored

- Use a PNG, JPEG, or WEBP attachment no larger than 20 MiB.
- Confirm Message Content Intent is enabled.
- Confirm the attachment is hosted by Discord and remains available when the threshold triggers.
- GIFs are intentionally excluded.

### Podman Compose provider is missing

If `podman compose` reports that neither `docker-compose` nor `podman-compose` exists, install `podman-compose`, open a new terminal, and verify `podman compose version`.

### PostgreSQL port 5432 is already in use

Change only the host side of this mapping in `infra/compose/compose.dev.yml`:

```yaml
ports:
  - "127.0.0.1:5433:5432"
```

Then update the host-development `DATABASE_URL` to port `5433`. The Compose worker continues to use the internal `postgres:5432` address.

### Changes were built but the running worker did not update

Some Compose providers may not recreate an already-running worker after a build. Recreate it without deleting volumes:

```powershell
podman compose -f infra/compose/compose.dev.yml --profile worker down
podman compose -f infra/compose/compose.dev.yml --profile worker up --build -d
```

Never add `-v` during this update cycle.
