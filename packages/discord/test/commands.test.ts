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
});
