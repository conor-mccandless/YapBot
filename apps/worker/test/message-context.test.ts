import { describe, expect, it } from "vitest";

import { RecentMessageContextStore } from "../src/message-context.js";

describe("RecentMessageContextStore", () => {
  it("returns the ordered messages that satisfy the configured threshold", () => {
    const store = new RecentMessageContextStore();
    for (let index = 0; index < 4; index += 1) {
      store.record({
        channelId: index % 2 === 0 ? "channel-1" : "channel-2",
        content: `message ${index + 1}`,
        eligibleImageAttachmentCount: index === 3 ? 1 : 0,
        guildId: "guild-1",
        nowMs: index * 1_000,
        userId: "user-1",
        windowSeconds: 30,
      });
    }

    expect(
      store.getRecent({
        guildId: "guild-1",
        limit: 3,
        nowMs: 3_000,
        userId: "user-1",
        windowSeconds: 30,
      }),
    ).toEqual([
      {
        channelId: "channel-2",
        content: "message 2",
        eligibleImageAttachmentCount: 0,
      },
      {
        channelId: "channel-1",
        content: "message 3",
        eligibleImageAttachmentCount: 0,
      },
      {
        channelId: "channel-2",
        content: "message 4",
        eligibleImageAttachmentCount: 1,
      },
    ]);
  });

  it("prunes expired messages and clears guild state", () => {
    const store = new RecentMessageContextStore();
    store.record({
      channelId: "channel-1",
      content: "expired",
      eligibleImageAttachmentCount: 0,
      guildId: "guild-1",
      nowMs: 0,
      userId: "user-1",
      windowSeconds: 30,
    });

    expect(
      store.getRecent({
        guildId: "guild-1",
        limit: 3,
        nowMs: 31_000,
        userId: "user-1",
        windowSeconds: 30,
      }),
    ).toEqual([]);
    store.clearGuild("guild-1");
    expect(store.size).toBe(0);
  });

  it("bounds each stored message to Discord's content limit", () => {
    const store = new RecentMessageContextStore();
    store.record({
      channelId: "channel-1",
      content: "m".repeat(2_100),
      eligibleImageAttachmentCount: 0,
      guildId: "guild-1",
      nowMs: 0,
      userId: "user-1",
      windowSeconds: 30,
    });

    expect(
      store.getRecent({
        guildId: "guild-1",
        limit: 3,
        nowMs: 0,
        userId: "user-1",
        windowSeconds: 30,
      })[0]?.content,
    ).toHaveLength(2_000);
  });
});
