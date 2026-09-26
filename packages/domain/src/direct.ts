export const DIRECT_GUILD_GUARD_MS = 5_000;
export const DIRECT_DEDUP_MS = 300_000;

export function selectInteractionLane(
  directEnabled: boolean,
  addressed: boolean,
) {
  return directEnabled && addressed ? "direct" : "passive_threshold";
}

export interface DirectTicket {
  guildId: string;
  userKey: string;
  epoch: number;
}

/** Single-worker, synchronous admission. Never touches passive detector state. */
export class DirectInteractionLimiter {
  private readonly users = new Map<string, number>();
  private readonly guilds = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private readonly active = new Map<string, DirectTicket>();
  private readonly epochs = new Map<string, number>();

  acquire(input: {
    guildId: string;
    userId: string;
    messageId: string;
    nowMs: number;
    cooldownSeconds: number;
  }):
    | { outcome: "admitted"; ticket: DirectTicket }
    | { outcome: "duplicate" | "in_flight" | "user_cooldown" | "guild_guard" } {
    const { guildId, userId, messageId, nowMs, cooldownSeconds } = input;
    this.sweep(nowMs);
    const messageKey = `${guildId}:${messageId}`;
    const userKey = `${guildId}:${userId}`;
    if (this.seen.has(messageKey)) return { outcome: "duplicate" };
    this.seen.set(messageKey, nowMs + DIRECT_DEDUP_MS);
    if (this.active.has(userKey)) return { outcome: "in_flight" };
    if ((this.users.get(userKey) ?? 0) > nowMs)
      return { outcome: "user_cooldown" };
    if ((this.guilds.get(guildId) ?? 0) > nowMs)
      return { outcome: "guild_guard" };
    const ticket = { guildId, userKey, epoch: this.epochs.get(guildId) ?? 0 };
    this.users.set(userKey, nowMs + cooldownSeconds * 1_000);
    this.guilds.set(guildId, nowMs + DIRECT_GUILD_GUARD_MS);
    this.active.set(userKey, ticket);
    return { outcome: "admitted", ticket };
  }

  isCurrent(ticket: DirectTicket): boolean {
    return (
      this.active.get(ticket.userKey) === ticket &&
      (this.epochs.get(ticket.guildId) ?? 0) === ticket.epoch
    );
  }

  finish(ticket: DirectTicket): void {
    if (this.active.get(ticket.userKey) === ticket)
      this.active.delete(ticket.userKey);
  }

  clearGuild(guildId: string): void {
    // Invalidate pending sends without releasing their in-flight lock or dedup.
    this.epochs.set(guildId, (this.epochs.get(guildId) ?? 0) + 1);
    for (const key of this.users.keys()) {
      if (key.startsWith(`${guildId}:`)) this.users.delete(key);
    }
    this.guilds.delete(guildId);
  }

  sweep(nowMs: number): void {
    for (const map of [this.users, this.guilds, this.seen]) {
      for (const [key, until] of map) if (until <= nowMs) map.delete(key);
    }
  }
}
