const DISCORD_IMAGE_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const DISCORD_IMAGE_URL_PATTERN =
  /https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/[^\s<>]+/giu;

export const MAX_IMAGE_COUNT = 3;
export const MAX_IMAGE_BYTES = 20 * 1_024 * 1_024;
export const MAX_TOTAL_IMAGE_BYTES = 50 * 1_024 * 1_024;
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 5_000;
const MAX_STORED_IMAGE_REFERENCES_PER_MEMBER = 12;

export interface DiscordImageReference {
  contentType: string;
  size: number | null;
  sourceAttachmentSequence?: number;
  sourceMessageId?: string;
  url: string;
}

export interface DownloadedDiscordImage {
  dataUrl: string;
  sourceAttachmentSequence: number;
  sourceMessageId: string;
}

export interface DiscordAttachmentLike {
  contentType: string | null;
  size: number;
  url: string;
}

export interface DiscordMessageImageInput {
  attachments: readonly DiscordAttachmentLike[];
  content: string;
  embedImageUrls: readonly string[];
}

interface StoredImageReference extends DiscordImageReference {
  createdAtMs: number;
}

interface MemberImageState {
  images: StoredImageReference[];
  lastActivityMs: number;
}

export function createDiscordImageReference(
  attachment: DiscordAttachmentLike,
): DiscordImageReference | undefined {
  if (
    !attachment.contentType ||
    !SUPPORTED_IMAGE_TYPES.has(attachment.contentType) ||
    attachment.size <= 0 ||
    attachment.size > MAX_IMAGE_BYTES ||
    !isAllowedDiscordImageUrl(attachment.url)
  ) {
    return undefined;
  }

  return {
    contentType: attachment.contentType,
    size: attachment.size,
    url: attachment.url,
  };
}

export function collectDiscordMessageImages(
  input: DiscordMessageImageInput,
): readonly DiscordImageReference[] {
  const references = [
    ...input.attachments
      .map((attachment) => createDiscordImageReference(attachment))
      .filter((image) => image !== undefined),
    ...input.embedImageUrls
      .map((url) => createDiscordImageReferenceFromUrl(url))
      .filter((image) => image !== undefined),
    ...(input.content.match(DISCORD_IMAGE_URL_PATTERN) ?? [])
      .map((url) => url.replace(/[),.!?]+$/u, ""))
      .map((url) => createDiscordImageReferenceFromUrl(url))
      .filter((image) => image !== undefined),
  ];
  const uniqueReferences = new Map<string, DiscordImageReference>();
  for (const reference of references) {
    const key = new URL(reference.url).pathname;
    if (!uniqueReferences.has(key)) {
      uniqueReferences.set(key, reference);
    }
  }

  return [...uniqueReferences.values()];
}

export function normalizeDiscordImageLinks(content: string): string {
  return content.replace(DISCORD_IMAGE_URL_PATTERN, (matchedUrl) => {
    const normalizedUrl = matchedUrl.replace(/[),.!?]+$/u, "");
    if (!createDiscordImageReferenceFromUrl(normalizedUrl)) {
      return matchedUrl;
    }

    return `[image supplied separately]${matchedUrl.slice(normalizedUrl.length)}`;
  });
}

export function createDiscordImageReferenceFromUrl(
  value: string,
): DiscordImageReference | undefined {
  if (!isAllowedDiscordImageUrl(value)) {
    return undefined;
  }

  const contentType = inferImageContentType(value);
  if (!contentType) {
    return undefined;
  }

  return { contentType, size: null, url: value };
}

export function isAllowedDiscordImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      DISCORD_IMAGE_HOSTS.has(url.hostname) &&
      url.pathname.startsWith("/attachments/") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export class RecentImageContextStore {
  readonly #states = new Map<string, MemberImageState>();

  record(input: {
    guildId: string;
    images: readonly DiscordImageReference[];
    messageId: string;
    nowMs: number;
    userId: string;
    windowSeconds: number;
  }): void {
    const key = memberKey(input.guildId, input.userId);
    const windowStartMs = input.nowMs - input.windowSeconds * 1_000;
    const state = this.#states.get(key) ?? {
      images: [],
      lastActivityMs: input.nowMs,
    };

    state.images = state.images.filter(
      (image) => image.createdAtMs >= windowStartMs,
    );
    state.images.push(
      ...input.images.map((image, index) => ({
        ...image,
        createdAtMs: input.nowMs,
        sourceAttachmentSequence: index + 1,
        sourceMessageId: input.messageId,
      })),
    );
    state.images = state.images.slice(-MAX_STORED_IMAGE_REFERENCES_PER_MEMBER);
    state.lastActivityMs = input.nowMs;
    this.#states.set(key, state);
  }

  getRecent(input: {
    guildId: string;
    nowMs: number;
    userId: string;
    windowSeconds: number;
  }): readonly DiscordImageReference[] {
    const key = memberKey(input.guildId, input.userId);
    const state = this.#states.get(key);
    if (!state) {
      return [];
    }

    const windowStartMs = input.nowMs - input.windowSeconds * 1_000;
    state.images = state.images.filter(
      (image) => image.createdAtMs >= windowStartMs,
    );
    return state.images.slice(-MAX_IMAGE_COUNT).map((image) => ({
      contentType: image.contentType,
      size: image.size,
      sourceAttachmentSequence: image.sourceAttachmentSequence ?? 1,
      sourceMessageId: image.sourceMessageId ?? "unknown",
      url: image.url,
    }));
  }

  clearGuild(guildId: string): void {
    const prefix = `${guildId}:`;
    for (const key of this.#states.keys()) {
      if (key.startsWith(prefix)) {
        this.#states.delete(key);
      }
    }
  }

  sweep(nowMs: number, maximumIdleSeconds: number): number {
    const oldestAllowedMs = nowMs - maximumIdleSeconds * 1_000;
    let removed = 0;
    for (const [key, state] of this.#states.entries()) {
      if (state.lastActivityMs < oldestAllowedMs) {
        this.#states.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.#states.size;
  }
}

export type ImageFetcher = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export async function downloadDiscordImages(
  references: readonly DiscordImageReference[],
  fetchImage: ImageFetcher = fetch,
): Promise<readonly DownloadedDiscordImage[]> {
  const images: DownloadedDiscordImage[] = [];
  let totalBytes = 0;

  for (const reference of references.slice(-MAX_IMAGE_COUNT)) {
    if (
      !SUPPORTED_IMAGE_TYPES.has(reference.contentType) ||
      !isAllowedDiscordImageUrl(reference.url) ||
      (reference.size !== null && reference.size <= 0) ||
      (reference.size !== null && reference.size > MAX_IMAGE_BYTES) ||
      (reference.size !== null &&
        totalBytes + reference.size > MAX_TOTAL_IMAGE_BYTES)
    ) {
      continue;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      IMAGE_DOWNLOAD_TIMEOUT_MS,
    );

    try {
      const response = await fetchImage(reference.url, {
        redirect: "error",
        signal: controller.signal,
      });
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0];
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (
        !response.ok ||
        !contentType ||
        !SUPPORTED_IMAGE_TYPES.has(contentType) ||
        (contentLength > 0 && contentLength > MAX_IMAGE_BYTES) ||
        (contentLength > 0 &&
          totalBytes + contentLength > MAX_TOTAL_IMAGE_BYTES)
      ) {
        continue;
      }

      const remainingBytes = Math.min(
        MAX_IMAGE_BYTES,
        MAX_TOTAL_IMAGE_BYTES - totalBytes,
      );
      const bytes = await readResponseBody(response, remainingBytes);
      if (bytes.byteLength === 0) {
        continue;
      }

      totalBytes += bytes.byteLength;
      images.push({
        dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
        sourceAttachmentSequence: reference.sourceAttachmentSequence ?? 1,
        sourceMessageId: reference.sourceMessageId ?? "unknown",
      });
    } catch {
      // A failed image must not prevent text generation or static fallback.
    } finally {
      clearTimeout(timeout);
    }
  }

  return images;
}

function inferImageContentType(value: string): string | undefined {
  const pathname = new URL(value).pathname.toLowerCase();
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }

  return undefined;
}

async function readResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    throw new Error("Image response has no body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    byteLength += value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel();
      throw new Error("Image exceeded the download byte limit");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function memberKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}
