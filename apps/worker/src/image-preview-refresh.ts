import { setTimeout as delay } from "node:timers/promises";

import {
  collectDiscordMessageImages,
  MAX_IMAGE_COUNT,
  type DiscordImageReference,
  type DiscordMessageImageInput,
} from "./image-context.js";
import type { YapMessageContext } from "./message-context.js";

export const MAX_PREVIEW_REFRESH_MESSAGES = 3;
export const PREVIEW_FETCH_TIMEOUT_MS = 2_000;
export const PREVIEW_RETRY_DELAY_MS = 750;

export interface PreviewMessage extends DiscordMessageImageInput {
  authorId: string;
  channelId: string;
  guildId: string | null;
  id: string;
}

export interface PreviewRefreshInput {
  guildId: string;
  userId: string;
  messages: readonly YapMessageContext[];
  imageReferences: readonly DiscordImageReference[];
  fetchMessage(message: YapMessageContext): Promise<PreviewMessage>;
}

function urlsIn(content: string): string[] {
  return content.match(/https?:\/\/[^\s<>]+/giu) ?? [];
}

// A hint declares missing visual context; it never authorizes a download.
function imageUrlHintCount(content: string): number {
  return urlsIn(content).filter((value) => {
    try {
      return /\.(?:jpe?g|png|webp)$/iu.test(
        new URL(value.replace(/[),.!?]+$/u, "")).pathname,
      );
    } catch {
      return false;
    }
  }).length;
}

async function fetchWithDeadline(
  fetchMessage: PreviewRefreshInput["fetchMessage"],
  message: YapMessageContext,
): Promise<PreviewMessage> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // Also turn a synchronous adapter failure into a rejected promise.
      Promise.resolve().then(() => fetchMessage(message)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Discord preview fetch timed out")),
          PREVIEW_FETCH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Refresh only this trigger's source messages. No store writes, new messages,
 * counter evaluations, external-site fetches, or late timeout mutations.
 */
export async function refreshConversationImages(input: PreviewRefreshInput) {
  const referencesByMessage = new Map<string, DiscordImageReference[]>();
  const messages = input.messages.map((message) => ({
    ...message,
    eligibleImageAttachmentCount: Math.max(
      message.eligibleImageAttachmentCount,
      imageUrlHintCount(message.content),
    ),
  }));
  for (const message of messages) {
    referencesByMessage.set(
      message.messageId,
      input.imageReferences.filter(
        (reference) => reference.sourceMessageId === message.messageId,
      ),
    );
  }
  const candidates = messages.filter(
    (message) => urlsIn(message.content).length > 0,
  );
  const selected = candidates.slice(-MAX_PREVIEW_REFRESH_MESSAGES);
  const diagnostics = {
    candidateCount: candidates.length,
    selectedCount: selected.length,
    fetchCount: 0,
    fetchFailureCount: 0,
    recoveredMessageCount: 0,
    unresolvedMessageCount: 0,
  };

  await Promise.all(
    selected.map(async (message) => {
      const initial = referencesByMessage.get(message.messageId) ?? [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await delay(PREVIEW_RETRY_DELAY_MS);
        }
        diagnostics.fetchCount += 1;
        let refreshed: PreviewMessage;
        try {
          refreshed = await fetchWithDeadline(input.fetchMessage, message);
          if (
            refreshed.guildId !== input.guildId ||
            refreshed.channelId !== message.channelId ||
            refreshed.authorId !== input.userId ||
            refreshed.id !== message.messageId
          ) {
            throw new Error("Discord preview source mismatch");
          }
        } catch {
          diagnostics.fetchFailureCount += 1;
          // Do not retry deleted/inaccessible messages or timed-out requests.
          break;
        }

        const images = collectDiscordMessageImages(refreshed).map(
          (reference, index) => ({
            ...reference,
            sourceAttachmentSequence: index + 1,
            sourceMessageId: message.messageId,
          }),
        );
        if (images.length > 0) {
          referencesByMessage.set(message.messageId, images);
          message.eligibleImageAttachmentCount = Math.max(
            message.eligibleImageAttachmentCount,
            images.length,
          );
          if (initial.length === 0) {
            diagnostics.recoveredMessageCount += 1;
          }
          break;
        }
        if (initial.length > 0) {
          break;
        }
      }
      if ((referencesByMessage.get(message.messageId)?.length ?? 0) === 0) {
        diagnostics.unresolvedMessageCount += 1;
      }
    }),
  );

  // Asynchronous fetch completion order must not change image chronology.
  const imageReferences = messages
    .flatMap((message) => referencesByMessage.get(message.messageId) ?? [])
    .slice(-MAX_IMAGE_COUNT);
  return { messages, imageReferences, diagnostics };
}
