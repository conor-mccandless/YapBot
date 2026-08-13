import { describe, expect, it, vi } from "vitest";

import {
  directlyAddressesYapBot,
  directlyRepliesToYapBot,
  normalizeYapBotMention,
  RecentMessageContextStore,
} from "../src/message-context.js";

describe("normalizeYapBotMention", () => {
  it("turns current and legacy Discord mention syntax into readable context", () => {
    expect(
      normalizeYapBotMention(
        "<@123> are you around? <@!123> answer me.",
        "123",
      ),
    ).toBe("@YapBot are you around? @YapBot answer me.");
  });

  it("recognizes a readable direct address when Discord metadata is absent", () => {
    expect(directlyAddressesYapBot("@YapBot do you understand this?")).toBe(
      true,
    );
    expect(directlyAddressesYapBot("a screenshot containing YapBot text")).toBe(
      false,
    );
  });
});

describe("directlyRepliesToYapBot", () => {
  it("recognizes a default Discord reply whose referenced author is YapBot", async () => {
    const fetchReference = vi.fn().mockResolvedValue({
      author: { id: "bot-1" },
    });

    await expect(
      directlyRepliesToYapBot(
        {
          fetchReference,
          reference: { messageId: "message-1", type: 0 },
        },
        "bot-1",
      ),
    ).resolves.toBe(true);
    expect(fetchReference).toHaveBeenCalledOnce();
  });

  it("does not fetch non-replies and safely ignores unavailable references", async () => {
    const fetchReference = vi.fn().mockRejectedValue(new Error("not found"));

    await expect(
      directlyRepliesToYapBot(
        { fetchReference, reference: { messageId: "message-1", type: 0 } },
        "bot-1",
      ),
    ).resolves.toBe(false);
    await expect(
      directlyRepliesToYapBot(
        { fetchReference, reference: { messageId: "message-2", type: 1 } },
        "bot-1",
      ),
    ).resolves.toBe(false);
    expect(fetchReference).toHaveBeenCalledOnce();
  });
});

describe("RecentMessageContextStore", () => {
  it("returns the ordered messages that satisfy the configured threshold", () => {
    const store = new RecentMessageContextStore();
    for (let index = 0; index < 4; index += 1) {
      store.record({
        channelId: index % 2 === 0 ? "channel-1" : "channel-2",
        content: `message ${index + 1}`,
        directlyMentionsBot: index === 2,
        eligibleImageAttachmentCount: index === 3 ? 1 : 0,
        guildId: "guild-1",
        messageId: `message-${index + 1}`,
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
        createdAtMs: 1_000,
        directlyMentionsBot: false,
        eligibleImageAttachmentCount: 0,
        messageId: "message-2",
      },
      {
        channelId: "channel-1",
        content: "message 3",
        createdAtMs: 2_000,
        directlyMentionsBot: true,
        eligibleImageAttachmentCount: 0,
        messageId: "message-3",
      },
      {
        channelId: "channel-2",
        content: "message 4",
        createdAtMs: 3_000,
        directlyMentionsBot: false,
        eligibleImageAttachmentCount: 1,
        messageId: "message-4",
      },
    ]);
  });

  it("prunes expired messages and clears guild state", () => {
    const store = new RecentMessageContextStore();
    store.record({
      channelId: "channel-1",
      content: "expired",
      directlyMentionsBot: false,
      eligibleImageAttachmentCount: 0,
      guildId: "guild-1",
      messageId: "message-1",
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
      directlyMentionsBot: false,
      eligibleImageAttachmentCount: 0,
      guildId: "guild-1",
      messageId: "message-1",
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
