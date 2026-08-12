import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const guildConfig = pgTable(
  "guild_config",
  {
    channelId: varchar("channel_id", { length: 20 }),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(600),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    enabled: boolean("enabled").notNull().default(false),
    guildId: varchar("guild_id", { length: 20 }).primaryKey(),
    monitoredRoleId: varchar("monitored_role_id", { length: 20 }),
    monitoredUserId: varchar("monitored_user_id", { length: 20 }),
    pingTarget: boolean("ping_target").notNull().default(true),
    setupComplete: boolean("setup_complete").notNull().default(false),
    targetType: varchar("target_type", { length: 16 }),
    threshold: integer("threshold").notNull().default(15),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    windowSeconds: integer("window_seconds").notNull().default(300),
  },
  (table) => [
    check(
      "guild_config_threshold_check",
      sql`${table.threshold} between 3 and 100`,
    ),
    check(
      "guild_config_window_check",
      sql`${table.windowSeconds} between 30 and 3600`,
    ),
    check(
      "guild_config_cooldown_check",
      sql`${table.cooldownSeconds} between 0 and 86400`,
    ),
    check(
      "guild_config_target_type_check",
      sql`${table.targetType} is null or ${table.targetType} in ('role', 'user')`,
    ),
    check(
      "guild_config_setup_check",
      sql`not ${table.setupComplete} or (
        ${table.channelId} is not null and (
          (${table.targetType} = 'role' and ${table.monitoredRoleId} is not null and ${table.monitoredUserId} is null)
          or
          (${table.targetType} = 'user' and ${table.monitoredUserId} is not null and ${table.monitoredRoleId} is null)
        )
      )`,
    ),
    check(
      "guild_config_enabled_check",
      sql`not ${table.enabled} or ${table.setupComplete}`,
    ),
  ],
);

export const llmDailyUsage = pgTable(
  "llm_daily_usage",
  {
    generationCount: integer("generation_count").notNull().default(0),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    usageDate: date("usage_date").notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.usageDate] })],
);

export const guildChannel = pgTable(
  "guild_channel",
  {
    channelId: varchar("channel_id", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    guildId: varchar("guild_id", { length: 20 })
      .notNull()
      .references(() => guildConfig.guildId, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.channelId] })],
);

export const userPersona = pgTable(
  "user_persona",
  {
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    description: varchar("description", { length: 500 }).notNull(),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: varchar("user_id", { length: 20 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const triggerEvent = pgTable(
  "trigger_event",
  {
    channelId: varchar("channel_id", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    latencyMs: integer("latency_ms").notNull(),
    messageCount: integer("message_count").notNull(),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 20 }).notNull(),
  },
  (table) => [
    index("trigger_event_guild_created_idx").on(table.guildId, table.createdAt),
  ],
);

export const adminAuditEvent = pgTable(
  "admin_audit_event",
  {
    actorUserId: varchar("actor_user_id", { length: 20 }).notNull(),
    change: jsonb("change").notNull(),
    commandName: varchar("command_name", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  },
  (table) => [
    index("admin_audit_event_guild_created_idx").on(
      table.guildId,
      table.createdAt,
    ),
  ],
);

export const schema = {
  adminAuditEvent,
  guildChannel,
  guildConfig,
  llmDailyUsage,
  triggerEvent,
  userPersona,
};
