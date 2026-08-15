import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";

import { YAP_COMMAND_JSON } from "../src/index.js";

describe("YAP_COMMAND_JSON", () => {
  it("exposes text-only channel management commands", () => {
    const subcommands = YAP_COMMAND_JSON.options ?? [];
    const names = subcommands.map((option) => option.name);

    expect(names).toContain("channel-add");
    expect(names).toContain("channel-remove");
    expect(names).toContain("channels");

    for (const subcommandName of ["setup", "channel-add", "channel-remove"]) {
      const subcommand = subcommands.find(
        (option) => option.name === subcommandName,
      );
      const channelOption = subcommand?.options?.find(
        (option) => option.name === "channel",
      );

      expect(channelOption?.channel_types).toEqual([ChannelType.GuildText]);
    }
  });

  it("allows persona descriptions up to 2,000 characters", () => {
    const personaSet = YAP_COMMAND_JSON.options?.find(
      (option) => option.name === "persona-set",
    );
    const description = personaSet?.options?.find(
      (option) => option.name === "description",
    );

    expect(description?.min_length).toBe(1);
    expect(description?.max_length).toBe(2_000);
  });

  it("exposes individual user-list management commands", () => {
    const subcommands = YAP_COMMAND_JSON.options ?? [];
    const names = subcommands.map((option) => option.name);

    expect(names).toContain("user-add");
    expect(names).toContain("user-remove");
    expect(names).toContain("users");

    for (const subcommandName of ["user-add", "user-remove"]) {
      const subcommand = subcommands.find(
        (option) => option.name === subcommandName,
      );
      const userOption = subcommand?.options?.find(
        (option) => option.name === "user",
      );

      expect(userOption?.required).toBe(true);
    }
  });
});
