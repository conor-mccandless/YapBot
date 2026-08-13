import { describe, expect, it, vi } from "vitest";

import {
  collectDiscordMessageImages,
  createDiscordImageReference,
  createDiscordImageReferenceFromUrl,
  downloadDiscordImages,
  isAllowedDiscordImageUrl,
  MAX_IMAGE_BYTES,
  normalizeDiscordImageLinks,
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

  it("accepts Discord CDN embed URLs without trusting a declared size", () => {
    expect(createDiscordImageReferenceFromUrl(image.url)).toEqual({
      contentType: "image/png",
      size: null,
      url: image.url,
    });
    expect(
      createDiscordImageReferenceFromUrl(
        "https://cdn.discordapp.com/attachments/123/456/image.gif",
      ),
    ).toBeUndefined();
  });

  it("accepts image URLs served through Discord's external media proxy", () => {
    const proxyUrl =
      "https://images-ext-1.discordapp.net/external/hash/https/example.com/photo.webp?format=webp";

    expect(createDiscordImageReferenceFromUrl(proxyUrl)).toEqual({
      contentType: "image/webp",
      size: null,
      url: proxyUrl,
    });
    expect(isAllowedDiscordImageUrl(proxyUrl)).toBe(true);
    expect(
      createDiscordImageReferenceFromUrl(
        "https://media.discordapp.net/external/hash/https/example.com/photo?format=webp",
      ),
    ).toEqual({
      contentType: "image/webp",
      size: null,
      url: "https://media.discordapp.net/external/hash/https/example.com/photo?format=webp",
    });
    expect(
      isAllowedDiscordImageUrl(
        "https://images-ext-1.discordapp.net/attachments/123/photo.webp",
      ),
    ).toBe(false);
  });

  it("collects and deduplicates attachments, embeds, and pasted CDN links", () => {
    expect(
      collectDiscordMessageImages({
        attachments: [image],
        content: `${image.url}?signed=true`,
        embedImageUrls: [
          "https://media.discordapp.net/attachments/123/456/image.png?width=900",
        ],
      }),
    ).toEqual([image]);

    expect(
      collectDiscordMessageImages({
        attachments: [],
        content: `look ${image.url}?signed=true`,
        embedImageUrls: [],
      }),
    ).toEqual([
      {
        contentType: "image/png",
        size: null,
        url: `${image.url}?signed=true`,
      },
    ]);
  });

  it("replaces recognized Discord image links without hiding other URLs", () => {
    expect(
      normalizeDiscordImageLinks(
        `look ${image.url}?signed=true, then https://example.com/page`,
      ),
    ).toBe("look [image supplied separately], then https://example.com/page");
    expect(
      normalizeDiscordImageLinks(
        "https://cdn.discordapp.com/attachments/123/456/animation.gif",
      ),
    ).toBe("https://cdn.discordapp.com/attachments/123/456/animation.gif");
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
            size: null,
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
