import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_PREVIEW_REFRESH_MESSAGES,
  PREVIEW_FETCH_TIMEOUT_MS,
  PREVIEW_RETRY_DELAY_MS,
  refreshConversationImages,
  type PreviewMessage,
} from "../src/image-preview-refresh.js";
import type { YapMessageContext } from "../src/message-context.js";
import {
  buildOpenAIInput,
  selectResponseDecision,
  validateGeneratedResponse,
} from "../src/response-generator.js";

const externalUrl = "https://m.media-amazon.com/images/I/example.jpg";
const proxyUrl =
  "https://images-ext-1.discordapp.net/external/hash/https/m.media-amazon.com/images/I/example.jpg";
const stored: YapMessageContext = {
  channelId: "channel-1",
  content: externalUrl,
  createdAtMs: 1_000,
  directlyMentionsBot: false,
  eligibleImageAttachmentCount: 0,
  messageId: "message-1",
};
const preview: PreviewMessage = {
  id: stored.messageId,
  authorId: "user-1",
  channelId: stored.channelId,
  guildId: "guild-1",
  content: externalUrl,
  attachments: [],
  embedImageUrls: [proxyUrl, externalUrl],
};
const base = {
  guildId: "guild-1",
  userId: "user-1",
  messages: [stored],
  imageReferences: [],
};

afterEach(() => vi.useRealTimers());

describe("trigger-time image preview refresh", () => {
  it("recovers a late external preview through Discord, not the external host", async () => {
    const fetchMessage = vi.fn().mockResolvedValue(preview);
    const result = await refreshConversationImages({ ...base, fetchMessage });

    expect(fetchMessage).toHaveBeenCalledTimes(1);
    expect(fetchMessage.mock.calls[0]?.[0].messageId).toBe(stored.messageId);
    expect(result.imageReferences).toEqual([
      {
        contentType: "image/jpeg",
        size: null,
        url: proxyUrl,
        sourceMessageId: stored.messageId,
        sourceAttachmentSequence: 1,
      },
    ]);
    expect(result.messages[0]?.eligibleImageAttachmentCount).toBe(1);
    expect(result.diagnostics.recoveredMessageCount).toBe(1);
    expect(
      selectResponseDecision(result.messages, false, result.imageReferences)
        .mode,
    ).toBe("visual_post");
    // Refresh operates on a snapshot, never appends/recounts the message.
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.createdAtMs).toBe(stored.createdAtMs);
    expect(stored.eligibleImageAttachmentCount).toBe(0);
    expect(base.imageReferences).toEqual([]);
  });

  it("retries once if the triggering message's embed is still being generated", async () => {
    vi.useFakeTimers();
    const fetchMessage = vi
      .fn()
      .mockResolvedValueOnce({ ...preview, embedImageUrls: [] })
      .mockResolvedValueOnce(preview);
    const pending = refreshConversationImages({ ...base, fetchMessage });
    await vi.advanceTimersByTimeAsync(PREVIEW_RETRY_DELAY_MS);
    const result = await pending;
    expect(fetchMessage).toHaveBeenCalledTimes(2);
    expect(result.imageReferences).toHaveLength(1);
    expect(result.diagnostics.fetchCount).toBe(2);
  });

  it("marks a recognizable but unavailable image as visual context, not a mystery link", async () => {
    vi.useFakeTimers();
    const fetchMessage = vi
      .fn()
      .mockResolvedValue({ ...preview, embedImageUrls: [] });
    const pending = refreshConversationImages({ ...base, fetchMessage });
    await vi.advanceTimersByTimeAsync(PREVIEW_RETRY_DELAY_MS);
    const result = await pending;
    expect(fetchMessage).toHaveBeenCalledTimes(2);
    expect(result.imageReferences).toEqual([]);
    expect(selectResponseDecision(result.messages).visualAvailability).toBe(
      "declared_but_unavailable",
    );
    expect(
      buildOpenAIInput({
        messageContent: externalUrl,
        messageContext: result.messages,
      }),
    ).toContain("A declared visual was unavailable");
    expect(
      validateGeneratedResponse("You posted a mystery link. Stop yapping.", {
        messageContent: externalUrl,
        messageContext: result.messages,
      }),
    ).toContain("visual_delivery_reference");
  });

  it("keeps generic web pages text-only if they have no image preview", async () => {
    vi.useFakeTimers();
    const content = "https://example.com/article";
    const pending = refreshConversationImages({
      ...base,
      messages: [{ ...stored, content }],
      fetchMessage: vi
        .fn()
        .mockResolvedValue({ ...preview, content, embedImageUrls: [] }),
    });
    await vi.advanceTimersByTimeAsync(PREVIEW_RETRY_DELAY_MS);
    const result = await pending;
    expect(result.messages[0]?.eligibleImageAttachmentCount).toBe(0);
    expect(selectResponseDecision(result.messages).visualAvailability).toBe(
      "none",
    );
  });

  it("recovers an extensionless web page's late thumbnail", async () => {
    const content = "https://example.com/article";
    const result = await refreshConversationImages({
      ...base,
      messages: [{ ...stored, content }],
      fetchMessage: vi.fn().mockResolvedValue({ ...preview, content }),
    });
    expect(result.imageReferences).toHaveLength(1);
    expect(result.messages[0]?.eligibleImageAttachmentCount).toBe(1);
  });

  it.each([403, 404])(
    "tolerates a %i without retrying or losing existing text",
    async (status) => {
      const fetchMessage = vi.fn().mockRejectedValue(new Error(String(status)));
      const result = await refreshConversationImages({ ...base, fetchMessage });
      expect(fetchMessage).toHaveBeenCalledTimes(1);
      expect(result.messages[0]?.content).toBe(stored.content);
      expect(result.imageReferences).toEqual([]);
      expect(result.diagnostics.fetchFailureCount).toBe(1);
    },
  );

  it("bounds a hung Discord fetch and does not mutate results if it resolves late", async () => {
    vi.useFakeTimers();
    let resolve!: (value: PreviewMessage) => void;
    const fetchMessage = vi.fn().mockImplementation(
      () =>
        new Promise<PreviewMessage>((done) => {
          resolve = done;
        }),
    );
    const pending = refreshConversationImages({ ...base, fetchMessage });
    await vi.advanceTimersByTimeAsync(PREVIEW_FETCH_TIMEOUT_MS);
    const result = await pending;
    expect(result.diagnostics.fetchFailureCount).toBe(1);
    resolve(preview);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.imageReferences).toEqual([]);
    expect(fetchMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    { guildId: "other-guild" },
    { channelId: "other-channel" },
    { authorId: "other-user" },
    { id: "other-message" },
  ])("rejects a mismatched source %j", async (change) => {
    const result = await refreshConversationImages({
      ...base,
      fetchMessage: vi.fn().mockResolvedValue({ ...preview, ...change }),
    });
    expect(result.imageReferences).toEqual([]);
    expect(result.diagnostics.fetchFailureCount).toBe(1);
  });

  it("does not fetch ordinary text or already captured uploaded images", async () => {
    const fetchMessage = vi.fn();
    const reference = {
      contentType: "image/png",
      size: 3,
      url: "https://cdn.discordapp.com/attachments/1/2/image.png",
      sourceMessageId: stored.messageId,
    };
    const result = await refreshConversationImages({
      ...base,
      messages: [
        { ...stored, content: "look at this", eligibleImageAttachmentCount: 1 },
      ],
      imageReferences: [
        reference,
        { ...reference, sourceMessageId: "outside-window" },
      ],
      fetchMessage,
    });
    expect(fetchMessage).not.toHaveBeenCalled();
    expect(result.imageReferences).toEqual([reference]);
  });

  it("bounds refresh candidates and preserves chronology despite fetch completion order", async () => {
    vi.useFakeTimers();
    const messages = Array.from({ length: 6 }, (_, index) => ({
      ...stored,
      messageId: `message-${index}`,
      channelId: `channel-${index}`,
      createdAtMs: index,
    }));
    const completionOrder: string[] = [];
    const fetchMessage = vi.fn(async (source: YapMessageContext) => {
      await new Promise((resolve) =>
        setTimeout(resolve, 6 - source.createdAtMs),
      );
      completionOrder.push(source.messageId);
      return { ...preview, id: source.messageId, channelId: source.channelId };
    });
    const pending = refreshConversationImages({
      ...base,
      messages,
      fetchMessage,
    });
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(completionOrder).toEqual(["message-5", "message-4", "message-3"]);
    expect(fetchMessage).toHaveBeenCalledTimes(MAX_PREVIEW_REFRESH_MESSAGES);
    expect(
      result.imageReferences.map((image) => image.sourceMessageId),
    ).toEqual(["message-3", "message-4", "message-5"]);
    expect(result.messages.map((message) => message.messageId)).toEqual(
      messages.map((message) => message.messageId),
    );
  });

  it("preserves a captured image if its metadata refresh fails", async () => {
    const reference = {
      contentType: "image/jpeg",
      size: null,
      url: proxyUrl,
      sourceMessageId: stored.messageId,
    };
    const result = await refreshConversationImages({
      ...base,
      imageReferences: [reference],
      messages: [{ ...stored, eligibleImageAttachmentCount: 1 }],
      fetchMessage: vi.fn().mockRejectedValue(new Error("unavailable")),
    });
    expect(result.imageReferences).toEqual([reference]);
    expect(result.diagnostics.unresolvedMessageCount).toBe(0);
  });

  it("preserves the direct-address priority when its image preview is recovered", async () => {
    const result = await refreshConversationImages({
      ...base,
      messages: [{ ...stored, directlyMentionsBot: true }],
      fetchMessage: vi.fn().mockResolvedValue(preview),
    });
    expect(
      selectResponseDecision(result.messages, true, result.imageReferences),
    ).toMatchObject({
      mode: "direct_address",
      visualAvailability: "available",
      personaAvailability: "present",
    });
  });

  it("does not fetch unsupported or private URLs as images", async () => {
    vi.useFakeTimers();
    const pending = refreshConversationImages({
      ...base,
      fetchMessage: vi.fn().mockResolvedValue({
        ...preview,
        embedImageUrls: [
          "http://127.0.0.1/image.jpg",
          externalUrl,
          "https://cdn.discordapp.com/attachments/1/2/animated.gif",
        ],
      }),
    });
    await vi.advanceTimersByTimeAsync(PREVIEW_RETRY_DELAY_MS);
    expect((await pending).imageReferences).toEqual([]);
  });
});
