import { and, count, eq, gte, lt } from "drizzle-orm";

import type { DatabaseConnection } from "./index.js";
import {
  adminAuditEvent,
  guildChannel,
  guildConfig,
  guildMonitoredUser,
  llmDailyUsage,
  triggerEvent,
  userPersona,
} from "./schema.js";

export type GuildConfig = typeof guildConfig.$inferSelect;
export type UserPersona = typeof userPersona.$inferSelect;

export const MAX_GUILD_CHANNELS = 25;
export const MAX_GUILD_MONITORED_USERS = 25;

export type AddGuildChannelResult =
  "added" | "already_exists" | "limit_reached" | "not_configured";

export type RemoveGuildChannelResult =
  "last_channel" | "not_configured" | "not_found" | "removed";

export type AddGuildMonitoredUserResult =
  | "added"
  | "already_exists"
  | "limit_reached"
  | "not_configured"
  | "role_target";

export type RemoveGuildMonitoredUserResult =
  "last_user" | "not_configured" | "not_found" | "removed" | "role_target";

export interface BehaviorUpdate {
  cooldownSeconds?: number;
  pingTarget?: boolean;
  threshold?: number;
  windowSeconds?: number;
}

export type SetupTarget =
  | { monitoredRoleId: string; targetType: "role" }
  | { monitoredUserId: string; targetType: "user" };

export class YapBotRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  async getGuildConfig(guildId: string): Promise<GuildConfig | undefined> {
    return this.connection.database.query.guildConfig.findFirst({
      where: eq(guildConfig.guildId, guildId),
    });
  }

  async getGuildChannelIds(guildId: string): Promise<string[]> {
    const rows = await this.connection.database
      .select({ channelId: guildChannel.channelId })
      .from(guildChannel)
      .where(eq(guildChannel.guildId, guildId));

    return rows.map((row) => row.channelId);
  }

  async getGuildMonitoredUserIds(guildId: string): Promise<string[]> {
    const rows = await this.connection.database
      .select({ userId: guildMonitoredUser.userId })
      .from(guildMonitoredUser)
      .where(eq(guildMonitoredUser.guildId, guildId));

    return rows.map((row) => row.userId);
  }

  async isGuildUserMonitored(
    guildId: string,
    userId: string,
    legacyUserId?: string | null,
  ): Promise<boolean> {
    const row =
      await this.connection.database.query.guildMonitoredUser.findFirst({
        columns: { userId: true },
        where: and(
          eq(guildMonitoredUser.guildId, guildId),
          eq(guildMonitoredUser.userId, userId),
        ),
      });

    return row !== undefined || legacyUserId === userId;
  }

  async addGuildMonitoredUser(input: {
    actorUserId: string;
    guildId: string;
    userId: string;
  }): Promise<AddGuildMonitoredUserResult> {
    return this.connection.database.transaction(async (transaction) => {
      const [config] = await transaction
        .select({
          setupComplete: guildConfig.setupComplete,
          targetType: guildConfig.targetType,
        })
        .from(guildConfig)
        .where(eq(guildConfig.guildId, input.guildId));
      if (!config?.setupComplete) {
        return "not_configured";
      }
      if (config.targetType !== "user") {
        return "role_target";
      }

      const [existing] = await transaction
        .select({ userId: guildMonitoredUser.userId })
        .from(guildMonitoredUser)
        .where(
          and(
            eq(guildMonitoredUser.guildId, input.guildId),
            eq(guildMonitoredUser.userId, input.userId),
          ),
        );
      if (existing) {
        return "already_exists";
      }

      const [userCount] = await transaction
        .select({ value: count() })
        .from(guildMonitoredUser)
        .where(eq(guildMonitoredUser.guildId, input.guildId));
      if ((userCount?.value ?? 0) >= MAX_GUILD_MONITORED_USERS) {
        return "limit_reached";
      }

      await transaction.insert(guildMonitoredUser).values({
        guildId: input.guildId,
        userId: input.userId,
      });
      await transaction.insert(adminAuditEvent).values({
        actorUserId: input.actorUserId,
        change: { userId: input.userId },
        commandName: "user-add",
        guildId: input.guildId,
      });

      return "added";
    });
  }

  async removeGuildMonitoredUser(input: {
    actorUserId: string;
    guildId: string;
    userId: string;
  }): Promise<RemoveGuildMonitoredUserResult> {
    return this.connection.database.transaction(async (transaction) => {
      const [config] = await transaction
        .select({
          monitoredUserId: guildConfig.monitoredUserId,
          setupComplete: guildConfig.setupComplete,
          targetType: guildConfig.targetType,
        })
        .from(guildConfig)
        .where(eq(guildConfig.guildId, input.guildId));
      if (!config?.setupComplete) {
        return "not_configured";
      }
      if (config.targetType !== "user") {
        return "role_target";
      }

      const users = await transaction
        .select({ userId: guildMonitoredUser.userId })
        .from(guildMonitoredUser)
        .where(eq(guildMonitoredUser.guildId, input.guildId));
      if (!users.some((user) => user.userId === input.userId)) {
        return "not_found";
      }
      if (users.length === 1) {
        return "last_user";
      }

      await transaction
        .delete(guildMonitoredUser)
        .where(
          and(
            eq(guildMonitoredUser.guildId, input.guildId),
            eq(guildMonitoredUser.userId, input.userId),
          ),
        );

      if (config.monitoredUserId === input.userId) {
        const replacement = users.find((user) => user.userId !== input.userId);
        await transaction
          .update(guildConfig)
          .set({
            monitoredUserId: replacement?.userId,
            updatedAt: new Date(),
          })
          .where(eq(guildConfig.guildId, input.guildId));
      }

      await transaction.insert(adminAuditEvent).values({
        actorUserId: input.actorUserId,
        change: { userId: input.userId },
        commandName: "user-remove",
        guildId: input.guildId,
      });

      return "removed";
    });
  }

  async isGuildChannelAllowed(
    guildId: string,
    channelId: string,
  ): Promise<boolean> {
    const row = await this.connection.database.query.guildChannel.findFirst({
      columns: { channelId: true },
      where: and(
        eq(guildChannel.guildId, guildId),
        eq(guildChannel.channelId, channelId),
      ),
    });

    return row !== undefined;
  }

  async addGuildChannel(input: {
    actorUserId: string;
    channelId: string;
    guildId: string;
  }): Promise<AddGuildChannelResult> {
    return this.connection.database.transaction(async (transaction) => {
      const [config] = await transaction
        .select({ setupComplete: guildConfig.setupComplete })
        .from(guildConfig)
        .where(eq(guildConfig.guildId, input.guildId));
      if (!config?.setupComplete) {
        return "not_configured";
      }

      const [existing] = await transaction
        .select({ channelId: guildChannel.channelId })
        .from(guildChannel)
        .where(
          and(
            eq(guildChannel.guildId, input.guildId),
            eq(guildChannel.channelId, input.channelId),
          ),
        );
      if (existing) {
        return "already_exists";
      }

      const [channelCount] = await transaction
        .select({ value: count() })
        .from(guildChannel)
        .where(eq(guildChannel.guildId, input.guildId));
      if ((channelCount?.value ?? 0) >= MAX_GUILD_CHANNELS) {
        return "limit_reached";
      }

      await transaction.insert(guildChannel).values({
        channelId: input.channelId,
        guildId: input.guildId,
      });
      await transaction.insert(adminAuditEvent).values({
        actorUserId: input.actorUserId,
        change: { channelId: input.channelId },
        commandName: "channel-add",
        guildId: input.guildId,
      });

      return "added";
    });
  }

  async removeGuildChannel(input: {
    actorUserId: string;
    channelId: string;
    guildId: string;
  }): Promise<RemoveGuildChannelResult> {
    return this.connection.database.transaction(async (transaction) => {
      const [config] = await transaction
        .select({
          channelId: guildConfig.channelId,
          setupComplete: guildConfig.setupComplete,
        })
        .from(guildConfig)
        .where(eq(guildConfig.guildId, input.guildId));
      if (!config?.setupComplete) {
        return "not_configured";
      }

      const channels = await transaction
        .select({ channelId: guildChannel.channelId })
        .from(guildChannel)
        .where(eq(guildChannel.guildId, input.guildId));
      if (!channels.some((channel) => channel.channelId === input.channelId)) {
        return "not_found";
      }
      if (channels.length === 1) {
        return "last_channel";
      }

      await transaction
        .delete(guildChannel)
        .where(
          and(
            eq(guildChannel.guildId, input.guildId),
            eq(guildChannel.channelId, input.channelId),
          ),
        );

      if (config.channelId === input.channelId) {
        const replacement = channels.find(
          (channel) => channel.channelId !== input.channelId,
        );
        await transaction
          .update(guildConfig)
          .set({ channelId: replacement?.channelId, updatedAt: new Date() })
          .where(eq(guildConfig.guildId, input.guildId));
      }

      await transaction.insert(adminAuditEvent).values({
        actorUserId: input.actorUserId,
        change: { channelId: input.channelId },
        commandName: "channel-remove",
        guildId: input.guildId,
      });

      return "removed";
    });
  }

  async getUserPersona(
    guildId: string,
    userId: string,
  ): Promise<UserPersona | undefined> {
    return this.connection.database.query.userPersona.findFirst({
      where: and(
        eq(userPersona.guildId, guildId),
        eq(userPersona.userId, userId),
      ),
    });
  }

  async setUserPersona(input: {
    actorUserId: string;
    description: string;
    guildId: string;
    userId: string;
  }): Promise<void> {
    await this.connection.database.transaction(async (transaction) => {
      await transaction
        .insert(userPersona)
        .values({
          description: input.description,
          guildId: input.guildId,
          userId: input.userId,
        })
        .onConflictDoUpdate({
          set: {
            description: input.description,
            updatedAt: new Date(),
          },
          target: [userPersona.guildId, userPersona.userId],
        });
      await transaction.insert(adminAuditEvent).values({
        actorUserId: input.actorUserId,
        change: {
          descriptionLength: input.description.length,
          userId: input.userId,
        },
        commandName: "persona-set",
        guildId: input.guildId,
      });
    });
  }

  async deleteUserPersona(input: {
    actorUserId: string;
    guildId: string;
    userId: string;
  }): Promise<boolean> {
    const rows = await this.connection.database.transaction(
      async (transaction) => {
        const deleted = await transaction
          .delete(userPersona)
          .where(
            and(
              eq(userPersona.guildId, input.guildId),
              eq(userPersona.userId, input.userId),
            ),
          )
          .returning({ userId: userPersona.userId });

        if (deleted.length > 0) {
          await transaction.insert(adminAuditEvent).values({
            actorUserId: input.actorUserId,
            change: { userId: input.userId },
            commandName: "persona-clear",
            guildId: input.guildId,
          });
        }

        return deleted;
      },
    );

    return rows.length > 0;
  }

  async setupGuild(
    input: {
      actorUserId: string;
      channelId: string;
      guildId: string;
    } & SetupTarget,
  ): Promise<void> {
    const target =
      input.targetType === "role"
        ? {
            monitoredRoleId: input.monitoredRoleId,
            monitoredUserId: null,
            targetType: input.targetType,
          }
        : {
            monitoredRoleId: null,
            monitoredUserId: input.monitoredUserId,
            targetType: input.targetType,
          };

    await this.connection.database.transaction(async (transaction) => {
      await transaction
        .insert(guildConfig)
        .values({
          channelId: input.channelId,
          enabled: false,
          guildId: input.guildId,
          setupComplete: true,
          ...target,
        })
        .onConflictDoUpdate({
          set: {
            channelId: input.channelId,
            enabled: false,
            setupComplete: true,
            ...target,
            updatedAt: new Date(),
          },
          target: guildConfig.guildId,
        });
      await transaction
        .delete(guildChannel)
        .where(eq(guildChannel.guildId, input.guildId));
      await transaction.insert(guildChannel).values({
        channelId: input.channelId,
        guildId: input.guildId,
      });
      await transaction
        .delete(guildMonitoredUser)
        .where(eq(guildMonitoredUser.guildId, input.guildId));
      if (input.targetType === "user") {
        await transaction.insert(guildMonitoredUser).values({
          guildId: input.guildId,
          userId: input.monitoredUserId,
        });
      }
      await transaction.insert(adminAuditEvent).values({
        actorUserId: input.actorUserId,
        change: {
          channelId: input.channelId,
          ...target,
        },
        commandName: "setup",
        guildId: input.guildId,
      });
    });
  }

  async configureGuild(input: {
    actorUserId: string;
    guildId: string;
    update: BehaviorUpdate;
  }): Promise<boolean> {
    const rows = await this.connection.database.transaction(
      async (transaction) => {
        const updated = await transaction
          .update(guildConfig)
          .set({ ...input.update, updatedAt: new Date() })
          .where(eq(guildConfig.guildId, input.guildId))
          .returning({ guildId: guildConfig.guildId });

        if (updated.length > 0) {
          await transaction.insert(adminAuditEvent).values({
            actorUserId: input.actorUserId,
            change: input.update,
            commandName: "configure",
            guildId: input.guildId,
          });
        }

        return updated;
      },
    );

    return rows.length > 0;
  }

  async setGuildEnabled(input: {
    actorUserId: string;
    enabled: boolean;
    guildId: string;
  }): Promise<boolean> {
    const rows = await this.connection.database.transaction(
      async (transaction) => {
        const condition = input.enabled
          ? and(
              eq(guildConfig.guildId, input.guildId),
              eq(guildConfig.setupComplete, true),
            )
          : eq(guildConfig.guildId, input.guildId);
        const updated = await transaction
          .update(guildConfig)
          .set({ enabled: input.enabled, updatedAt: new Date() })
          .where(condition)
          .returning({ guildId: guildConfig.guildId });

        if (updated.length > 0) {
          await transaction.insert(adminAuditEvent).values({
            actorUserId: input.actorUserId,
            change: { enabled: input.enabled },
            commandName: input.enabled ? "enable" : "disable",
            guildId: input.guildId,
          });
        }

        return updated;
      },
    );

    return rows.length > 0;
  }

  async countTriggersToday(guildId: string, now = new Date()): Promise<number> {
    const utcStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [row] = await this.connection.database
      .select({ value: count() })
      .from(triggerEvent)
      .where(
        and(
          eq(triggerEvent.guildId, guildId),
          gte(triggerEvent.createdAt, utcStart),
        ),
      );

    return row?.value ?? 0;
  }

  async tryReserveLlmGeneration(
    guildId: string,
    dailyLimit: number,
    now = new Date(),
  ): Promise<boolean> {
    const usageDate = now.toISOString().slice(0, 10);
    const rows = await this.connection.client<{ generation_count: number }[]>`
      insert into llm_daily_usage (guild_id, usage_date, generation_count)
      values (${guildId}, ${usageDate}, 1)
      on conflict (guild_id, usage_date) do update
      set generation_count = llm_daily_usage.generation_count + 1
      where llm_daily_usage.generation_count < ${dailyLimit}
      returning generation_count
    `;

    return rows.length > 0;
  }

  async recordTrigger(input: {
    channelId: string;
    guildId: string;
    latencyMs: number;
    messageCount: number;
    outcome: "openai_response" | "send_failed" | "static_response";
    userId: string;
  }): Promise<void> {
    await this.connection.database.insert(triggerEvent).values(input);
  }

  async cleanupExpired(now = new Date()): Promise<void> {
    const triggerCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    const auditCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1_000);
    const usageCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);

    await this.connection.database.transaction(async (transaction) => {
      await transaction
        .delete(triggerEvent)
        .where(lt(triggerEvent.createdAt, triggerCutoff));
      await transaction
        .delete(adminAuditEvent)
        .where(lt(adminAuditEvent.createdAt, auditCutoff));
      await transaction
        .delete(llmDailyUsage)
        .where(lt(llmDailyUsage.usageDate, usageCutoff));
    });
  }
}
