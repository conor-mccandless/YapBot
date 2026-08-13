import { describe, expect, it, vi } from "vitest";

import {
  createDiscordImageReference,
  downloadDiscordImages,
  isAllowedDiscordImageUrl,
  MAX_IMAGE_BYTES,
  RecentImageContextStore,
} from "../src/image-context.js";

const image = {
  contentType: "image/png",
  size: 3,
  url: "https://cdn.discordapp.com/attachments/123/456/image.png",
};

describe("Discord image validation", () => {
  it("accepts bounded Discord CDN image attachments", () => {
    expect(createDiscordImageReference(image)).toEqual(image);
    expect(isAllowedDiscordImageUrl(image.url)).toBe(true);
  });

  it("rejects unsupported, oversized, and non-Discord attachments", () => {
    expect(
      createDiscordImageReference({ ...image, contentType: "image/gif" }),
    ).toBeUndefined();
    expect(
      createDiscordImageReference({ ...image, size: MAX_IMAGE_BYTES + 1 }),
    ).toBeUndefined();
    expect(
      createDiscordImageReference({
        ...image,
        url: "https://example.com/attachments/image.png",
      }),
    ).toBeUndefined();
  });
});

describe("RecentImageContextStore", () => {
  it("returns only the latest three images inside the rolling window", () => {
    const store = new RecentImageContextStore();
    for (let index = 0; index < 4; index += 1) {
      store.record({
        guildId: "guild-1",
        images: [{ ...image, url: `${image.url}?v=${index}` }],
        messageId: `message-${index}`,
        nowMs: index * 1_000,
        userId: "user-1",
        windowSeconds: 30,
      });
    }

    expect(
      store.getRecent({
        guildId: "guild-1",
        nowMs: 3_000,
        userId: "user-1",
        windowSeconds: 30,
      }),
    ).toHaveLength(3);
  });

  it("prunes expired images and clears guild state", () => {
    const store = new RecentImageContextStore();
    store.record({
      guildId: "guild-1",
      images: [image],
      messageId: "message-1",
      nowMs: 0,
      userId: "user-1",
      windowSeconds: 30,
    });

    expect(
      store.getRecent({
        guildId: "guild-1",
        nowMs: 31_000,
        userId: "user-1",
        windowSeconds: 30,
      }),
    ).toEqual([]);
    store.clearGuild("guild-1");
    expect(store.size).toBe(0);
  });
});

describe("downloadDiscordImages", () => {
  it("downloads an eligible image as a bounded data URL", async () => {
    const fetchImage = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-length": "3",
          "content-type": "image/png",
        },
        status: 200,
      }),
    );

    await expect(
      downloadDiscordImages(
        [
          {
            ...image,
            sourceAttachmentSequence: 2,
            sourceMessageId: "message-3",
          },
        ],
        fetchImage,
      ),
    ).resolves.toEqual([
      {
        dataUrl: "data:image/png;base64,AQID",
        sourceAttachmentSequence: 2,
        sourceMessageId: "message-3",
      },
    ]);
    expect(fetchImage).toHaveBeenCalledWith(
      image.url,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("accepts Discord CDN transcoding between supported image types", async () => {
    const webpReference = { ...image, contentType: "image/webp" };
    const fetchImage = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-length": "3",
          "content-type": "image/png",
        },
        status: 200,
      }),
    );

    await expect(
      downloadDiscordImages([webpReference], fetchImage),
    ).resolves.toEqual([
      {
        dataUrl: "data:image/png;base64,AQID",
        sourceAttachmentSequence: 1,
        sourceMessageId: "unknown",
      },
    ]);
  });

  it("skips failed and MIME-mismatched downloads", async () => {
    const mismatched = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "text/html" },
        status: 200,
      }),
    );
    const failed = vi.fn().mockRejectedValue(new Error("network failure"));

    await expect(downloadDiscordImages([image], mismatched)).resolves.toEqual(
      [],
    );
    await expect(downloadDiscordImages([image], failed)).resolves.toEqual([]);
  });
});
