import type { DirectInteractionLimiter } from "@yapbot/domain";
import type { YapBotRepository } from "@yapbot/db";
import {
  buildDirectContext,
  directMediaCandidates,
  type DirectMessage,
} from "./direct-context.js";
import {
  generateDirectResponse,
  type DirectDiagnostic,
  type DirectModelRequest,
} from "./direct-generator.js";
import { downloadDiscordImages } from "./image-context.js";
import { refreshConversationImages } from "./image-preview-refresh.js";

export async function withDirectDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs = 3_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Direct context timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface DirectServices {
  botId: string;
  limiter: DirectInteractionLimiter;
  cooldownSeconds: number;
  dailyLimit: number;
  repository: Pick<
    YapBotRepository,
    "tryReserveDirectGeneration" | "getUserPersona"
  >;
  model: DirectModelRequest | undefined;
  fetchHistory(): Promise<DirectMessage[]>;
  fetchReply(): Promise<DirectMessage | undefined>;
  fetchMessage(id: string): Promise<DirectMessage>;
  canSend(): Promise<boolean>;
  sendReply(content: string): Promise<void>;
  now?: () => number;
  downloadImages?: typeof downloadDiscordImages;
  diagnose?(diagnostic: DirectDiagnostic): void;
  log(fields: Record<string, unknown>): void;
}

export async function handleDirectInteraction(
  request: DirectMessage,
  services: DirectServices,
): Promise<void> {
  const now = services.now ?? Date.now;
  const started = now();
  const admission = services.limiter.acquire({
    guildId: request.guildId,
    userId: request.author.id,
    messageId: request.id,
    cooldownSeconds: services.cooldownSeconds,
    nowMs: started,
  });
  const base = {
    interactionLane: "direct",
    guildId: request.guildId,
    channelId: request.channelId,
    requesterId: request.author.id,
    requestId: request.id,
  };
  if (admission.outcome !== "admitted") {
    services.log({ ...base, outcome: admission.outcome });
    return;
  }
  try {
    const limitations: string[] = [];
    const [history, reply] = await Promise.all([
      withDirectDeadline(services.fetchHistory).catch(() => {
        limitations.push("Recent channel history could not be fetched.");
        return [];
      }),
      withDirectDeadline(services.fetchReply).catch(() => {
        limitations.push("The referenced message is unavailable.");
        return undefined;
      }),
    ]);
    const context = buildDirectContext(
      request,
      history,
      services.botId,
      reply,
      limitations,
    );
    const ambiguous = context.subjectResolution.method === "ambiguous";
    let allowModel = false;
    let quotaOutcome = "not_required";
    if (!ambiguous && services.model) {
      try {
        allowModel = await services.repository.tryReserveDirectGeneration(
          request.guildId,
          services.dailyLimit,
        );
        quotaOutcome = allowModel ? "reserved" : "daily_limit";
      } catch {
        quotaOutcome = "reservation_failed";
      }
    }
    if (allowModel) {
      const [media, profiles] = await Promise.all([
        Promise.all(
          directMediaCandidates(context).map(async (source) => {
            const refreshed = await refreshConversationImages({
              guildId: request.guildId,
              userId: source.author.id,
              messages: [
                {
                  channelId: source.channelId,
                  messageId: source.id,
                  content: source.content,
                  createdAtMs: source.createdAtMs,
                  directlyMentionsBot: false,
                  eligibleImageAttachmentCount: source.declaredImageCount,
                },
              ],
              imageReferences: source.images.map((image, index) => ({
                ...image,
                sourceMessageId: source.id,
                sourceAttachmentSequence: index + 1,
              })),
              fetchMessage: async () => {
                const fresh = await services.fetchMessage(source.id);
                return {
                  id: fresh.id,
                  guildId: fresh.guildId,
                  channelId: fresh.channelId,
                  authorId: fresh.author.id,
                  content: fresh.content,
                  attachments: [],
                  embedImageUrls: fresh.images.map((image) => image.url),
                };
              },
            });
            source.declaredImageCount =
              refreshed.messages[0]?.eligibleImageAttachmentCount ??
              source.declaredImageCount;
            return refreshed.imageReferences;
          }),
        ),
        Promise.all(
          context.subjectResolution.subjects.slice(0, 2).map(async (person) => {
            const persona = await withDirectDeadline(() =>
              services.repository.getUserPersona(request.guildId, person.id),
            ).catch(() => undefined);
            return persona
              ? {
                  userId: person.id,
                  description: persona.description.slice(0, 2_000),
                }
              : undefined;
          }),
        ),
      ]);
      context.images = await (services.downloadImages ?? downloadDiscordImages)(
        media.flat().slice(0, 3),
      );
      context.subjectPersonas = profiles.filter(
        (profile) => profile !== undefined,
      );
    }
    const generated =
      quotaOutcome === "reservation_failed"
        ? {
            source: "static",
            reason: "quota_reservation_failed",
            content:
              "My commentary engine hit a snag. Try that again in a moment.",
          }
        : await generateDirectResponse(
            context,
            services.model,
            allowModel,
            services.diagnose,
          );
    if (
      !services.limiter.isCurrent(admission.ticket) ||
      !(await services.canSend())
    ) {
      services.log({ ...base, outcome: "cancelled_configuration_changed" });
      return;
    }
    await services.sendReply(generated.content);
    services.log({
      ...base,
      outcome: generated.source,
      reason: generated.reason,
      quotaOutcome,
      subjectResolution: context.subjectResolution.method,
      subjectIds: context.subjectResolution.subjects.map((p) => p.id),
      contextMessageCount: context.recentConversation.length,
      contextParticipantCount: new Set(
        context.recentConversation.map((m) => m.author.id),
      ).size,
      imageCount: context.images.length,
      latencyMs: now() - started,
    });
  } catch {
    services.log({
      ...base,
      outcome: "handler_failed",
      latencyMs: now() - started,
    });
  } finally {
    services.limiter.finish(admission.ticket);
  }
}
