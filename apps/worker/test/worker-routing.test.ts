import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType, Events } from "discord.js";
import type { AppEnvironment } from "@yapbot/config";
import type { YapBotRepository } from "@yapbot/db";
import type { Logger } from "pino";
import type * as DiscordModule from "discord.js";
import type * as DirectGeneratorModule from "../src/direct-generator.js";
import type * as ResponseGeneratorModule from "../src/response-generator.js";

const harness = vi.hoisted(() => ({
  listeners: new Map<string, (...args: never[]) => Promise<void>>(),
  directModel: vi.fn(),
  passiveModel: vi.fn(),
  client: {} as Record<string, unknown>,
}));
vi.mock("discord.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DiscordModule>();
  return {
    ...actual,
    Client: class {
      user = { id: "bot" };
      channels = { cache: new Map() };
      guilds = { cache: new Map() };
      constructor() {
        harness.client = this as unknown as Record<string, unknown>;
      }
      once() {}
      on(event: string, callback: (...args: never[]) => Promise<void>) {
        harness.listeners.set(event, callback);
      }
      async login() {}
      destroy() {}
    },
  };
});
vi.mock("../src/direct-generator.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DirectGeneratorModule>()),
  createDirectModelRequest: () => harness.directModel,
}));
vi.mock("../src/response-generator.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ResponseGeneratorModule>()),
  createOpenAITextRequest: () => harness.passiveModel,
}));
import { startWorker, type RunningWorker } from "../src/worker.js";

let running: RunningWorker;
let clock = 100_000;
let serial = 0;
const messages = new Map<string, ReturnType<typeof message>>();
const channel = {
  id: "c",
  guildId: "g",
  type: ChannelType.GuildText,
  permissionsFor: () => ({ has: () => true }),
  messages: {
    fetch: vi.fn(async (options: { message?: string }) =>
      options.message ? messages.get(options.message) : messages,
    ),
  },
};
function message(
  user: string,
  content: string,
  changes: Record<string, unknown> = {},
) {
  return {
    id: String(++serial),
    content,
    guildId: "g",
    channelId: "c",
    channel,
    author: { id: user, username: user, globalName: user, bot: false },
    createdTimestamp: clock++,
    member: { displayName: user, roles: { cache: new Map([["role", {}]]) } },
    client: harness.client,
    inGuild: () => true,
    webhookId: null,
    system: false,
    mentions: {
      users: new Map(
        content.includes("<@bot>")
          ? [["bot", { id: "bot", username: "YapBot", bot: true }]]
          : [],
      ),
      roles: new Map(),
      members: new Map(),
    },
    attachments: new Map(),
    embeds: [],
    reference: null,
    reply: vi.fn().mockResolvedValue(undefined),
    ...changes,
  };
}
const config = {
  guildId: "g",
  channelId: "c",
  enabled: true,
  setupComplete: true,
  directResponsesEnabled: false,
  directCooldownSeconds: 30,
  directContextMinutes: 30,
  targetType: "role",
  monitoredRoleId: "role",
  monitoredUserId: null,
  threshold: 3,
  windowSeconds: 120,
  cooldownSeconds: 60,
  pingTarget: true,
};
const repository = {
  getGuildConfig: vi.fn(async () => ({ ...config })),
  isGuildChannelAllowed: vi.fn(async () => false),
  isGuildUserMonitored: vi.fn(async () => false),
  getGuildMonitoredRoleIds: vi.fn(async () => ["role"]),
  getUserPersona: vi.fn(async () => undefined),
  tryReserveLlmGeneration: vi.fn(async () => true),
  tryReserveDirectGeneration: vi.fn(async () => true),
  recordTrigger: vi.fn(),
  cleanupExpired: vi.fn(),
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
async function send(value: ReturnType<typeof message>) {
  await harness.listeners.get(Events.MessageCreate)!(value as never);
  messages.set(value.id, value);
}

beforeEach(async () => {
  vi.clearAllMocks();
  harness.listeners.clear();
  messages.clear();
  serial = 0;
  config.directResponsesEnabled = false;
  config.directContextMinutes = 30;
  config.enabled = true;
  repository.isGuildChannelAllowed.mockReset().mockResolvedValue(false);
  harness.directModel.mockResolvedValue({
    status: "completed",
    text: "Freddy thinks coffee is lunch.",
  });
  harness.passiveModel.mockResolvedValue({
    status: "completed",
    text: "That is a coffee rollout. Stop yapping.",
  });
  running = await startWorker(
    {
      ALLOWED_GUILD_IDS: ["g"],
      OPENAI_API_KEY: "test",
      OPENAI_MODEL: "model",
      OPENAI_MAX_OUTPUT_TOKENS: 900,
      OPENAI_DIRECT_MAX_OUTPUT_TOKENS: 1200,
      OPENAI_REASONING_EFFORT: "low",
      OPENAI_TIMEOUT_MS: 1000,
      OPENAI_DAILY_GUILD_LIMIT: 100,
      OPENAI_DIRECT_DAILY_GUILD_LIMIT: 50,
      OPENAI_LOG_PROMPT_DIAGNOSTICS: false,
      OPENAI_LOG_REJECTED_RESPONSES: false,
      DISCORD_TOKEN: "test",
    } as AppEnvironment,
    logger as unknown as Logger,
    repository as unknown as YapBotRepository,
  );
  (harness.client.channels as { cache: Map<string, unknown> }).cache.set(
    "c",
    channel,
  );
});
afterEach(async () => {
  await running.stop();
});

describe("worker lane compatibility", () => {
  it.each([
    [30, 0],
    [60, 1],
  ])(
    "uses the guild's %s-minute window for a 45-minute-old message",
    async (minutes, expectedCount) => {
      config.directResponsesEnabled = true;
      config.directContextMinutes = minutes!;
      const prior = message("Freddy", "Coffee is lunch.", {
        createdTimestamp: clock - 45 * 60_000,
      });
      messages.set(prior.id, prior);
      await send(message("Observer", "<@bot> what's going on here?"));
      expect(harness.directModel).toHaveBeenCalledTimes(1);
      expect(
        harness.directModel.mock.calls[0]![0].recentConversation,
      ).toHaveLength(expectedCount!);
    },
  );
  it("recognizes a reply to YapBot without another explicit ping", async () => {
    config.directResponsesEnabled = true;
    const prior = message("YapBot", "Coffee isn't lunch.", {
      author: { id: "bot", username: "YapBot", bot: true },
    });
    messages.set(prior.id, prior);
    const followup = message("Observer", "why?", {
      reference: { type: 0, channelId: "c", messageId: prior.id },
    });
    await send(followup);
    expect(harness.directModel).toHaveBeenCalledTimes(1);
    expect(harness.directModel.mock.calls[0]![0].repliedTo.id).toBe(prior.id);
    expect(repository.recordTrigger).not.toHaveBeenCalled();
  });

  it("recognizes a plain leading address but not incidental YapBot discussion", async () => {
    config.directResponsesEnabled = true;
    await send(message("Observer", "I saw YapBot yesterday"));
    expect(harness.directModel).not.toHaveBeenCalled();
    await send(message("Observer", "YapBot what happened?"));
    expect(harness.directModel).toHaveBeenCalledTimes(1);
  });
  it("keeps interleaved three-message thresholds independent", async () => {
    for (let i = 0; i < 3; i++) {
      await send(message("Freddy", "coffee"));
      await send(message("Steve", "drink"));
    }
    expect(harness.passiveModel).toHaveBeenCalledTimes(2);
    expect(
      repository.recordTrigger.mock.calls.map(
        (call) => (call[0] as { userId: string }).userId,
      ),
    ).toEqual(["Freddy", "Steve"]);
    expect(harness.directModel).not.toHaveBeenCalled();
  });
  it("keeps legacy direct-address threshold behavior when the feature is off", async () => {
    await send(message("Freddy", "coffee"));
    await send(message("Freddy", "drink"));
    await send(message("Freddy", "<@bot> hello"));
    expect(harness.passiveModel).toHaveBeenCalledTimes(1);
    expect(harness.directModel).not.toHaveBeenCalled();
    expect(
      harness.passiveModel.mock.calls[0]![0].messageContext.at(-1)
        .directlyMentionsBot,
    ).toBe(true);
  });
  it("lets an unmonitored observer request a recap without passive eligibility checks", async () => {
    config.directResponsesEnabled = true;
    messages.set("old", message("Freddy", "coffee is lunch"));
    const observer = message("Observer", "<@bot> what's going on?", {
      member: { displayName: "Observer", roles: { cache: new Map() } },
    });
    await send(observer);
    expect(harness.directModel).toHaveBeenCalledTimes(1);
    expect(repository.isGuildUserMonitored).not.toHaveBeenCalled();
    expect(repository.tryReserveLlmGeneration).not.toHaveBeenCalled();
    expect(repository.recordTrigger).not.toHaveBeenCalled();
    expect(observer.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMentions: { parse: [], repliedUser: false },
      }),
    );
  });
  it("does not count a direct question as the third passive message", async () => {
    config.directResponsesEnabled = true;
    await send(message("Freddy", "one"));
    await send(message("Freddy", "two"));
    await send(message("Freddy", "<@bot> what do you think?"));
    expect(harness.passiveModel).not.toHaveBeenCalled();
    await send(message("Freddy", "third ordinary post"));
    expect(harness.passiveModel).toHaveBeenCalledTimes(1);
    expect(harness.directModel).toHaveBeenCalledTimes(1);
  });
  it("does not count cooldown-rejected direct questions", async () => {
    config.directResponsesEnabled = true;
    for (let i = 0; i < 4; i++) await send(message("Freddy", "<@bot> hello"));
    expect(harness.directModel).toHaveBeenCalledTimes(1);
    expect(harness.passiveModel).not.toHaveBeenCalled();
    expect(repository.recordTrigger).not.toHaveBeenCalled();
  });
  it("keeps guild-wide per-user aggregation across configured channels", async () => {
    repository.isGuildChannelAllowed.mockResolvedValue(true);
    await send(message("Freddy", "one"));
    await send(
      message("Freddy", "two", {
        channelId: "second",
        channel: { ...channel, id: "second" },
      }),
    );
    await send(message("Freddy", "three"));
    expect(harness.passiveModel).toHaveBeenCalledTimes(1);
  });
  it("ignores master-disabled, bot and unapproved messages", async () => {
    config.directResponsesEnabled = true;
    config.enabled = false;
    await send(message("Freddy", "<@bot> hello"));
    config.enabled = true;
    await send(message("Freddy", "<@bot> hello", { guildId: "other" }));
    await send(
      message("Freddy", "<@bot> hello", {
        author: { id: "otherbot", bot: true },
      }),
    );
    expect(harness.directModel).not.toHaveBeenCalled();
    expect(harness.passiveModel).not.toHaveBeenCalled();
  });
});
