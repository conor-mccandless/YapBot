const MAX_DISCORD_MESSAGE_CHARACTERS = 2_000;
const MAX_STORED_MESSAGES_PER_MEMBER = 100;

export interface YapMessageContext {
  channelId: string;
  content: string;
  createdAtMs: number;
  directlyMentionsBot: boolean;
  eligibleImageAttachmentCount: number;
  messageId: string;
}

type StoredMessageContext = YapMessageContext;

interface MemberMessageState {
  lastActivityMs: number;
  messages: StoredMessageContext[];
}

export class RecentMessageContextStore {
  readonly #states = new Map<string, MemberMessageState>();

  record(input: {
    channelId: string;
    content: string;
    directlyMentionsBot: boolean;
    eligibleImageAttachmentCount: number;
    guildId: string;
    messageId: string;
    nowMs: number;
    userId: string;
    windowSeconds: number;
  }): void {
    const key = memberKey(input.guildId, input.userId);
    const windowStartMs = input.nowMs - input.windowSeconds * 1_000;
    const state = this.#states.get(key) ?? {
      lastActivityMs: input.nowMs,
      messages: [],
    };

    state.messages = state.messages.filter(
      (message) => message.createdAtMs >= windowStartMs,
    );
    state.messages.push({
      channelId: input.channelId,
      content: input.content.slice(0, MAX_DISCORD_MESSAGE_CHARACTERS),
      createdAtMs: input.nowMs,
      directlyMentionsBot: input.directlyMentionsBot,
      eligibleImageAttachmentCount: input.eligibleImageAttachmentCount,
      messageId: input.messageId,
    });
    state.messages = state.messages.slice(-MAX_STORED_MESSAGES_PER_MEMBER);
    state.lastActivityMs = input.nowMs;
    this.#states.set(key, state);
  }

  getRecent(input: {
    guildId: string;
    limit: number;
    nowMs: number;
    userId: string;
    windowSeconds: number;
  }): readonly YapMessageContext[] {
    const key = memberKey(input.guildId, input.userId);
    const state = this.#states.get(key);
    if (!state) {
      return [];
    }

    const windowStartMs = input.nowMs - input.windowSeconds * 1_000;
    state.messages = state.messages.filter(
      (message) => message.createdAtMs >= windowStartMs,
    );
    return state.messages.slice(-input.limit).map((message) => ({
      channelId: message.channelId,
      content: message.content,
      createdAtMs: message.createdAtMs,
      directlyMentionsBot: message.directlyMentionsBot,
      eligibleImageAttachmentCount: message.eligibleImageAttachmentCount,
      messageId: message.messageId,
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

export function normalizeYapBotMention(
  content: string,
  botUserId?: string,
): string {
  if (!botUserId) {
    return content;
  }

  return content
    .replaceAll(`<@${botUserId}>`, "@YapBot")
    .replaceAll(`<@!${botUserId}>`, "@YapBot");
}

function memberKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}
