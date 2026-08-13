import type { AppEnvironment } from "@yapbot/config";
import type { YapBotRepository } from "@yapbot/db";
import {
  MESSAGE_CONTENT_GATEWAY_INTENT,
  REQUIRED_GATEWAY_INTENTS,
  YAP_COMMAND_JSON,
} from "@yapbot/discord";
import { KeyedMutex, RollingTriggerDetector } from "@yapbot/domain";
import { ChannelType, Client, Events } from "discord.js";
import type { Logger } from "pino";

import { handleYapCommand } from "./commands.js";
import {
  collectDiscordMessageImages,
  downloadDiscordImages,
  normalizeDiscordImageLinks,
  RecentImageContextStore,
} from "./image-context.js";
import {
  directlyAddressesYapBot,
  directlyRepliesToYapBot,
  normalizeYapBotMention,
  RecentMessageContextStore,
} from "./message-context.js";
import {
  createOpenAITextRequest,
  selectOpenAIModel,
  selectResponseDecision,
  YAPBOT_PROMPT_VERSION,
  YapResponseGenerator,
} from "./response-generator.js";
import { matchesConfiguredTarget } from "./targeting.js";

export interface RunningWorker {
  stop(): Promise<void>;
}

export async function startWorker(
  environment: AppEnvironment,
  logger: Logger,
  repository: YapBotRepository,
): Promise<RunningWorker> {
  const client = new Client({
    intents: [
      ...REQUIRED_GATEWAY_INTENTS,
      ...(environment.OPENAI_API_KEY ? [MESSAGE_CONTENT_GATEWAY_INTENT] : []),
    ],
  });
  const allowedGuildIds = new Set(environment.ALLOWED_GUILD_IDS);
  const detector = new RollingTriggerDetector();
  const imageContextStore = new RecentImageContextStore();
  const messageContextStore = new RecentMessageContextStore();
  const mutex = new KeyedMutex();
  const responseGenerator = new YapResponseGenerator(
    environment.OPENAI_API_KEY
      ? createOpenAITextRequest({
          apiKey: environment.OPENAI_API_KEY,
          ...(environment.OPENAI_IMAGE_MODEL
            ? { imageModel: environment.OPENAI_IMAGE_MODEL }
            : {}),
          maxOutputTokens: environment.OPENAI_MAX_OUTPUT_TOKENS,
          model: environment.OPENAI_MODEL,
          reasoningEffort: environment.OPENAI_REASONING_EFFORT,
          timeoutMs: environment.OPENAI_TIMEOUT_MS,
        })
      : undefined,
  );

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(
      {
        approvedGuildCount: environment.ALLOWED_GUILD_IDS.length,
        botUserId: readyClient.user.id,
        openAIEnabled: responseGenerator.openAIConfigured,
      },
      "Discord worker ready",
    );

    for (const guild of readyClient.guilds.cache.values()) {
      if (!allowedGuildIds.has(guild.id)) {
        logger.warn({ guildId: guild.id }, "Ignoring unapproved guild");
        continue;
      }

      try {
        await guild.commands.set([YAP_COMMAND_JSON]);
        logger.info({ guildId: guild.id }, "Registered guild commands");
      } catch (error) {
        logger.error(
          { error, guildId: guild.id },
          "Failed to register guild commands",
        );
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !== "yap"
    ) {
      return;
    }

    logger.info(
      {
        command: interaction.options.getSubcommand(false),
        guildId: interaction.guildId,
        interactionAgeMs: Date.now() - interaction.createdTimestamp,
      },
      "Received YapBot command",
    );

    try {
      await handleYapCommand(interaction, {
        allowedGuildIds,
        detector,
        imageContextStore,
        messageContextStore,
        repository,
      });
    } catch (error) {
      logger.error(
        {
          command: interaction.options.getSubcommand(false),
          error,
          guildId: interaction.guildId,
          interactionAgeMs: Date.now() - interaction.createdTimestamp,
        },
        "Command failed",
      );
      const response = {
        content: "YapBot could not complete that command.",
        ephemeral: true,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(response.content).catch(() => undefined);
      } else {
        await interaction.reply(response).catch(() => undefined);
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (
      !message.inGuild() ||
      !allowedGuildIds.has(message.guildId) ||
      message.author.bot ||
      message.webhookId ||
      message.system ||
      message.channel.type !== ChannelType.GuildText
    ) {
      return;
    }

    const key = `${message.guildId}:${message.author.id}`;
    await mutex.runExclusive(key, async () => {
      const config = await repository.getGuildConfig(message.guildId);
      const channelAllowed =
        message.channelId === config?.channelId ||
        (config?.enabled
          ? await repository.isGuildChannelAllowed(
              message.guildId,
              message.channelId,
            )
          : false);
      if (
        !config?.enabled ||
        !channelAllowed ||
        !matchesConfiguredTarget(
          config,
          message.author.id,
          (roleId) => message.member?.roles.cache.has(roleId) ?? false,
        )
      ) {
        return;
      }

      const nowMs = Date.now();
      const decision = detector.evaluate({
        cooldownSeconds: config.cooldownSeconds,
        guildId: message.guildId,
        nowMs,
        threshold: config.threshold,
        userId: message.author.id,
        windowSeconds: config.windowSeconds,
      });
      const messageImages = collectDiscordMessageImages({
        attachments: [...message.attachments.values()],
        content: message.content,
        embedImageUrls: message.embeds.flatMap((embed) =>
          [
            embed.image?.proxyURL,
            embed.thumbnail?.proxyURL,
            embed.image?.url,
            embed.thumbnail?.url,
          ].filter((url): url is string => url !== undefined),
        ),
      });
      const normalizedMessageContent = normalizeDiscordImageLinks(
        normalizeYapBotMention(message.content, client.user?.id),
      );
      const explicitlyAddressesBot =
        (client.user ? message.mentions.users.has(client.user.id) : false) ||
        directlyAddressesYapBot(normalizedMessageContent);
      const directlyMentionsBot =
        explicitlyAddressesBot ||
        (await directlyRepliesToYapBot(message, client.user?.id));
      if (responseGenerator.openAIConfigured) {
        messageContextStore.record({
          channelId: message.channelId,
          content: normalizedMessageContent,
          directlyMentionsBot,
          eligibleImageAttachmentCount: messageImages.length,
          guildId: message.guildId,
          messageId: message.id,
          nowMs,
          userId: message.author.id,
          windowSeconds: config.windowSeconds,
        });
      }
      imageContextStore.record({
        guildId: message.guildId,
        images: messageImages,
        messageId: message.id,
        nowMs,
        userId: message.author.id,
        windowSeconds: config.windowSeconds,
      });
      if (decision.outcome !== "trigger") {
        return;
      }

      const startedAt = Date.now();
      let outcome: "openai_response" | "send_failed" | "static_response";
      try {
        const recentImages = imageContextStore.getRecent({
          guildId: message.guildId,
          nowMs,
          userId: message.author.id,
          windowSeconds: config.windowSeconds,
        });
        const recentMessages = messageContextStore.getRecent({
          guildId: message.guildId,
          limit: config.threshold,
          nowMs,
          userId: message.author.id,
          windowSeconds: config.windowSeconds,
        });
        const recentMessageIds = new Set(
          recentMessages.map((recentMessage) => recentMessage.messageId),
        );
        const conversationImageReferences = recentImages.filter(
          (image) =>
            image.sourceMessageId !== undefined &&
            recentMessageIds.has(image.sourceMessageId),
        );
        const images = responseGenerator.openAIConfigured
          ? await downloadDiscordImages(conversationImageReferences)
          : [];

        let personaDescription: string | undefined;
        try {
          personaDescription = (
            await repository.getUserPersona(message.guildId, message.author.id)
          )?.description;
        } catch (error) {
          logger.error(
            { error, guildId: message.guildId, userId: message.author.id },
            "Failed to load user persona",
          );
        }
        const responseDecision = selectResponseDecision(
          recentMessages,
          Boolean(personaDescription?.trim()),
          images,
        );

        let allowOpenAI = false;
        if (responseGenerator.openAIConfigured) {
          try {
            allowOpenAI = await repository.tryReserveLlmGeneration(
              message.guildId,
              environment.OPENAI_DAILY_GUILD_LIMIT,
            );
          } catch (error) {
            logger.error(
              { error, guildId: message.guildId },
              "Failed to reserve OpenAI generation quota",
            );
          }
        }

        const generationStartedAt = Date.now();
        const generated = await responseGenerator.generate(
          normalizedMessageContent,
          allowOpenAI,
          personaDescription,
          images,
          {
            messageCount: decision.count,
            threshold: config.threshold,
            windowSeconds: config.windowSeconds,
          },
          recentMessages,
        );
        logger.info(
          {
            generationLatencyMs: Date.now() - generationStartedAt,
            conversationWindowMessageCount: recentMessages.length,
            declaredConversationImageCount: recentMessages.reduce(
              (total, recentMessage) =>
                total + recentMessage.eligibleImageAttachmentCount,
              0,
            ),
            directAddressSequence: responseDecision.directAddressSequence,
            primaryMessageSequence: responseDecision.primaryMessageSequence,
            imageDownloadFailureCount:
              conversationImageReferences.length - images.length,
            imageCount: images.length,
            imageReferenceCount: conversationImageReferences.length,
            model: responseGenerator.openAIConfigured
              ? selectOpenAIModel(
                  {
                    images,
                    messageContent: normalizedMessageContent,
                  },
                  environment.OPENAI_MODEL,
                  environment.OPENAI_IMAGE_MODEL,
                )
              : null,
            maxOutputTokens: environment.OPENAI_MAX_OUTPUT_TOKENS,
            openAIAttemptCount:
              generated.openAIMetadata?.attemptCount ??
              (generated.openAIMetadata ? 1 : null),
            openAICorrectionReasons:
              generated.openAIMetadata?.correctionReasons ?? [],
            openAIIncompleteReason:
              generated.openAIMetadata?.incompleteReason ?? null,
            openAIInputTokens:
              generated.openAIMetadata?.usage?.inputTokens ?? null,
            openAIOutputTokens:
              generated.openAIMetadata?.usage?.outputTokens ?? null,
            openAIReasoningTokens:
              generated.openAIMetadata?.usage?.reasoningTokens ?? null,
            openAIStatus: generated.openAIMetadata?.status ?? null,
            openAITotalTokens:
              generated.openAIMetadata?.usage?.totalTokens ?? null,
            outputWordCount: generated.content.split(/\s+/).filter(Boolean)
              .length,
            personaPresent: Boolean(personaDescription?.trim()),
            promptVersion: YAPBOT_PROMPT_VERSION,
            responseMode: responseDecision.mode,
            responseRationaleFlavor: responseDecision.rationaleFlavor,
            responseVisualAvailability: responseDecision.visualAvailability,
            reasoningEffort: environment.OPENAI_REASONING_EFFORT,
            source: generated.source,
          },
          "Generated YapBot response",
        );
        outcome =
          generated.source === "openai" ? "openai_response" : "static_response";
        if (
          generated.source === "static" &&
          responseGenerator.openAIConfigured
        ) {
          logger.warn(
            {
              fallbackReason: generated.fallbackReason,
              guildId: message.guildId,
              imageCount: images.length,
              imageReferenceCount: conversationImageReferences.length,
            },
            "Used static response fallback",
          );
        }
        const content = config.pingTarget
          ? `<@${message.author.id}> ${generated.content}`
          : generated.content;
        await message.reply({
          allowedMentions: {
            parse: [],
            repliedUser: false,
            users: config.pingTarget ? [message.author.id] : [],
          },
          content,
        });
      } catch (error) {
        outcome = "send_failed";
        logger.error(
          { channelId: message.channelId, error, guildId: message.guildId },
          "Failed to send YapBot response",
        );
      }

      await repository.recordTrigger({
        channelId: message.channelId,
        guildId: message.guildId,
        latencyMs: Date.now() - startedAt,
        messageCount: decision.count,
        outcome,
        userId: message.author.id,
      });
    });
  });

  client.on(Events.Warn, (warning) => {
    logger.warn({ warning }, "Discord client warning");
  });

  client.on(Events.Error, (error) => {
    logger.error({ error }, "Discord client error");
  });

  await client.login(environment.DISCORD_TOKEN);

  const sweepInterval = setInterval(() => {
    detector.sweep(Date.now(), 86_400 + 3_600);
    imageContextStore.sweep(Date.now(), 86_400 + 3_600);
    messageContextStore.sweep(Date.now(), 86_400 + 3_600);
  }, 60_000);
  sweepInterval.unref();

  const cleanupInterval = setInterval(
    () => {
      void repository.cleanupExpired().catch((error: unknown) => {
        logger.error({ error }, "Metadata retention cleanup failed");
      });
    },
    24 * 60 * 60 * 1_000,
  );
  cleanupInterval.unref();

  return {
    async stop() {
      logger.info("Stopping Discord worker");
      clearInterval(sweepInterval);
      clearInterval(cleanupInterval);
      client.destroy();
    },
  };
}
