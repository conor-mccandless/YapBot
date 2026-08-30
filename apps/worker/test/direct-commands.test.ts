import { describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import { handleYapCommand, type CommandContext } from "../src/commands.js";

function fixture(
  admin: boolean,
  enabled: boolean | null = true,
  cooldown: number | null = 30,
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
      getSubcommand: () => "direct-config",
      getBoolean: () => enabled,
      getInteger: () => cooldown,
    },
  };
  const context = {
    allowedGuildIds: new Set(["g"]),
    repository: { configureDirect: vi.fn().mockResolvedValue(true) },
    detector: { clearGuild: vi.fn() },
    directLimiter: { clearGuild: vi.fn() },
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
    expect(f.context.repository.configureDirect).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("Manage Server"),
    );
  });
  it("allows Manage Server while leaving passive counters untouched", async () => {
    const f = fixture(true);
    await f.run();
    expect(f.context.repository.configureDirect).toHaveBeenCalledWith({
      actorUserId: "actor",
      guildId: "g",
      update: { directResponsesEnabled: true, directCooldownSeconds: 30 },
    });
    expect(f.context.detector.clearGuild).not.toHaveBeenCalled();
    expect(f.context.directLimiter.clearGuild).toHaveBeenCalledWith("g");
  });
  it("allows the guild owner", async () => {
    const f = fixture(false);
    f.interaction.guild.ownerId = "actor";
    await f.run();
    expect(f.context.repository.configureDirect).toHaveBeenCalledTimes(1);
  });
  it.each([-1, 3601, 1.5])("rejects invalid cooldown %s", async (n) => {
    const f = fixture(true, null, n);
    await f.run();
    expect(f.context.repository.configureDirect).not.toHaveBeenCalled();
  });
  it("rejects empty updates", async () => {
    const f = fixture(true, null, null);
    await f.run();
    expect(f.context.repository.configureDirect).not.toHaveBeenCalled();
  });
});
