import {
  ChannelType,
  PermissionFlagsBits,
  type Message,
  type User,
} from "discord.js";
import type { AppEnvironment } from "@yapbot/config";
import type { YapBotRepository, GuildConfig } from "@yapbot/db";
import type { DirectInteractionLimiter } from "@yapbot/domain";
import type { Logger } from "pino";
import { collectDiscordMessageImages } from "./image-context.js";
import {
  directlyAddressesYapBot,
  directlyMentionsYapBotRole,
  normalizeYapBotMention,
} from "./message-context.js";
import type { DirectMessage, Participant } from "./direct-context.js";
import {
  handleDirectInteraction,
  withDirectDeadline,
} from "./direct-handler.js";
import {
  DIRECT_INSTRUCTIONS,
  DIRECT_PROMPT_VERSION,
  type DirectModelRequest,
} from "./direct-generator.js";

function participant(user: User, displayName?: string): Participant {
  return {
    id: user.id,
    username: user.username,
    displayName: (displayName ?? user.globalName ?? user.username).slice(
      0,
      100,
    ),
    bot: user.bot,
    ...(user.globalName ? { globalName: user.globalName } : {}),
  };
}

export function snapshotDirectMessage(message: Message<true>): DirectMessage {
  const images = collectDiscordMessageImages({
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
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    author: participant(message.author, message.member?.displayName),
    content: normalizeYapBotMention(message.content, message.client.user.id),
    createdAtMs: message.createdTimestamp,
    ignored: Boolean(message.webhookId || message.system),
    mentions: [...message.mentions.users.values()]
      .filter(
        (user) =>
          message.content.includes(`<@${user.id}>`) ||
          message.content.includes(`<@!${user.id}>`),
      )
      .map((user) =>
        participant(user, message.mentions.members?.get(user.id)?.displayName),
      ),
    ...(message.reference?.messageId &&
    message.reference.channelId === message.channelId
      ? { replyToId: message.reference.messageId }
      : {}),
    images,
    declaredImageCount: images.length,
  };
}

export async function isDirectDiscordAddress(
  message: Message<true>,
): Promise<boolean> {
  const botId = message.client.user.id;
  if (
    message.mentions.users.has(botId) ||
    directlyMentionsYapBotRole(message.mentions.roles.values(), botId) ||
    directlyAddressesYapBot(normalizeYapBotMention(message.content, botId))
  )
    return true;
  const reference = message.reference;
  if (
    !reference?.messageId ||
    reference.type !== 0 ||
    reference.channelId !== message.channelId
  )
    return false;
  return withDirectDeadline(
    async () =>
      (
        await message.channel.messages.fetch({
          message: reference.messageId!,
          cache: false,
        })
      ).author.id === botId,
  ).catch(() => false);
}

export async function runDirectDiscordInteraction(
  message: Message<true>,
  config: GuildConfig,
  repository: YapBotRepository,
  limiter: DirectInteractionLimiter,
  model: DirectModelRequest | undefined,
  environment: AppEnvironment,
  logger: Logger,
): Promise<void> {
  const channel = message.channel;
  const fetchMessage = async (id: string) =>
    snapshotDirectMessage(
      await channel.messages.fetch({ message: id, force: true, cache: false }),
    );
  await handleDirectInteraction(snapshotDirectMessage(message), {
    botId: message.client.user.id,
    repository,
    limiter,
    model,
    cooldownSeconds: config.directCooldownSeconds,
    dailyLimit: environment.OPENAI_DIRECT_DAILY_GUILD_LIMIT,
    fetchHistory: async () =>
      [
        ...(
          await channel.messages.fetch({
            before: message.id,
            limit: 50,
            cache: false,
          })
        ).values(),
      ].map(snapshotDirectMessage),
    fetchReply: async () =>
      message.reference?.type === 0 &&
      message.reference.channelId === message.channelId &&
      message.reference.messageId
        ? fetchMessage(message.reference.messageId)
        : undefined,
    fetchMessage,
    canSend: async () => {
      const fresh = await repository.getGuildConfig(message.guildId);
      return Boolean(
        fresh?.enabled &&
        fresh.setupComplete &&
        fresh.directResponsesEnabled &&
        channel.type === ChannelType.GuildText &&
        channel
          .permissionsFor(message.client.user)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
          ]) &&
        (fresh.channelId === channel.id ||
          (await repository.isGuildChannelAllowed(
            message.guildId,
            channel.id,
          ))),
      );
    },
    sendReply: async (content) => {
      await message.reply({
        content,
        allowedMentions: { parse: [], repliedUser: false },
      });
    },
    diagnose: (diagnostic) => {
      const { prompt, responseText, ...metadata } = diagnostic;
      logger.info(
        {
          ...metadata,
          interactionLane: "direct",
          requestId: message.id,
          guildId: message.guildId,
          promptVersion: DIRECT_PROMPT_VERSION,
          maxOutputTokens: environment.OPENAI_MAX_OUTPUT_TOKENS,
          reasoningEffort: environment.OPENAI_REASONING_EFFORT,
          ...(environment.OPENAI_LOG_PROMPT_DIAGNOSTICS && prompt
            ? { inputText: prompt, instructions: DIRECT_INSTRUCTIONS }
            : {}),
          ...(environment.OPENAI_LOG_REJECTED_RESPONSES && responseText
            ? { responseText }
            : {}),
        },
        "Direct interaction model diagnostic",
      );
    },
    log: (fields) =>
      logger.info(
        { ...fields, promptVersion: DIRECT_PROMPT_VERSION },
        "Direct interaction outcome",
      ),
  });
}
