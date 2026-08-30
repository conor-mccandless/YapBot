import { describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import { handleYapCommand, type CommandContext } from "../src/commands.js";

function fixture(
  admin: boolean,
  settings: Record<string, boolean | number> = {
    "direct-enabled": true,
    "direct-cooldown-seconds": 30,
  },
) {
  const interaction = {
    deferReply: vi.fn(),
    editReply: vi.fn(),
    inCachedGuild: () => true,
    guildId: "g",
    guild: { ownerId: "owner" },
    user: { id: "actor" },
    memberPermissions: { has: () => admin },
    options: {
      getSubcommand: () => "configure",
      getBoolean: (name: string) => settings[name] ?? null,
      getInteger: (name: string) => settings[name] ?? null,
    },
  };
  const context = {
    allowedGuildIds: new Set(["g"]),
    repository: { configureGuild: vi.fn().mockResolvedValue(true) },
    detector: { clearGuild: vi.fn() },
    directLimiter: { clearGuild: vi.fn() },
    imageContextStore: { clearGuild: vi.fn() },
    messageContextStore: { clearGuild: vi.fn() },
  };
  return {
    interaction,
    context,
    run: () =>
      handleYapCommand(
        interaction as unknown as ChatInputCommandInteraction,
        context as unknown as CommandContext,
      ),
  };
}

describe("direct configuration authorization", () => {
  it("rejects non-admin mutation", async () => {
    const f = fixture(false);
    await f.run();
    expect(f.context.repository.configureGuild).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Manage Server"),
    );
  });
  it("allows Manage Server while leaving passive counters untouched", async () => {
    const f = fixture(true);
    await f.run();
    expect(f.context.repository.configureGuild).toHaveBeenCalledWith({
      actorUserId: "actor",
      guildId: "g",
      update: { directResponsesEnabled: true, directCooldownSeconds: 30 },
    });
    expect(f.context.detector.clearGuild).not.toHaveBeenCalled();
    expect(f.context.imageContextStore.clearGuild).not.toHaveBeenCalled();
    expect(f.context.messageContextStore.clearGuild).not.toHaveBeenCalled();
    expect(f.context.directLimiter.clearGuild).toHaveBeenCalledWith("g");
  });
  it("allows the guild owner", async () => {
    const f = fixture(false);
    f.interaction.guild.ownerId = "actor";
    await f.run();
    expect(f.context.repository.configureGuild).toHaveBeenCalledTimes(1);
  });
  it.each([-1, 3601, 1.5])("rejects invalid cooldown %s", async (n) => {
    const f = fixture(true, { "direct-cooldown-seconds": n, threshold: 5 });
    await f.run();
    expect(f.context.repository.configureGuild).not.toHaveBeenCalled();
    expect(f.context.detector.clearGuild).not.toHaveBeenCalled();
    expect(f.context.directLimiter.clearGuild).not.toHaveBeenCalled();
  });
  it("rejects empty updates", async () => {
    const f = fixture(true, {});
    await f.run();
    expect(f.context.repository.configureGuild).not.toHaveBeenCalled();
  });
  it("keeps passive-only options independent and resets runtime state", async () => {
    const f = fixture(true, {
      threshold: 5,
      "window-seconds": 90,
      "cooldown-seconds": 60,
      "ping-target": false,
    });
    await f.run();
    expect(f.context.repository.configureGuild).toHaveBeenCalledWith({
      actorUserId: "actor",
      guildId: "g",
      update: {
        threshold: 5,
        windowSeconds: 90,
        cooldownSeconds: 60,
        pingTarget: false,
      },
    });
    expect(f.context.detector.clearGuild).toHaveBeenCalledWith("g");
    expect(f.context.imageContextStore.clearGuild).toHaveBeenCalledWith("g");
    expect(f.context.messageContextStore.clearGuild).toHaveBeenCalledWith("g");
    expect(f.context.directLimiter.clearGuild).toHaveBeenCalledWith("g");
  });
  it("saves mixed settings in one operation with distinct cooldowns", async () => {
    const f = fixture(true, {
      "cooldown-seconds": 60,
      "direct-enabled": true,
      "direct-cooldown-seconds": 10,
    });
    await f.run();
    expect(f.context.repository.configureGuild).toHaveBeenCalledTimes(1);
    expect(f.context.repository.configureGuild).toHaveBeenCalledWith({
      actorUserId: "actor",
      guildId: "g",
      update: {
        cooldownSeconds: 60,
        directResponsesEnabled: true,
        directCooldownSeconds: 10,
      },
    });
    expect(f.context.detector.clearGuild).toHaveBeenCalledTimes(1);
    expect(f.context.directLimiter.clearGuild).toHaveBeenCalledTimes(1);
  });
  it("preserves explicit false and zero values", async () => {
    const f = fixture(true, {
      "direct-enabled": false,
      "direct-cooldown-seconds": 0,
    });
    await f.run();
    expect(f.context.repository.configureGuild).toHaveBeenCalledWith({
      actorUserId: "actor",
      guildId: "g",
      update: { directResponsesEnabled: false, directCooldownSeconds: 0 },
    });
    expect(f.context.detector.clearGuild).not.toHaveBeenCalled();
  });
  it("does not reset state before setup", async () => {
    const f = fixture(true);
    f.context.repository.configureGuild.mockResolvedValue(false);
    await f.run();
    expect(f.context.detector.clearGuild).not.toHaveBeenCalled();
    expect(f.context.directLimiter.clearGuild).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("/yap setup"),
    );
  });
  it("does not reset state when persistence fails", async () => {
    const f = fixture(true, { threshold: 5, "direct-enabled": true });
    f.context.repository.configureGuild.mockRejectedValue(
      new Error("Database unavailable"),
    );
    await expect(f.run()).rejects.toThrow("Database unavailable");
    expect(f.context.detector.clearGuild).not.toHaveBeenCalled();
    expect(f.context.directLimiter.clearGuild).not.toHaveBeenCalled();
  });
});
