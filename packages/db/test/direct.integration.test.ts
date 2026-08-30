import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabaseConnection,
  runMigrations,
  YapBotRepository,
  type DatabaseConnection,
} from "../src/index.js";

// Never point the destructive fixture at the live database.
const testUrl = process.env.YAPBOT_TEST_DATABASE_URL;
if (
  testUrl &&
  !/^\/yapbot_direct_test_[a-z0-9_]+$/u.test(new URL(testUrl).pathname)
) {
  throw new Error(
    "Integration tests require a disposable yapbot_direct_test_* database",
  );
}
const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
let connection: DatabaseConnection;
let repository: YapBotRepository;
let before: unknown;
const guild = "100000000000000001";
const other = "100000000000000002";

describe.skipIf(!testUrl)("direct interactions PostgreSQL upgrade", () => {
  beforeAll(async () => {
    connection = createDatabaseConnection(testUrl!);
    repository = new YapBotRepository(connection);
    const legacy = await mkdtemp(
      path.join(tmpdir(), "yapbot-legacy-migrations-"),
    );
    try {
      for (const name of await readdir(migrations)) {
        if (/^000[1-7]_.*\.sql$/u.test(name))
          await copyFile(path.join(migrations, name), path.join(legacy, name));
      }
      await runMigrations(connection.client, legacy);
    } finally {
      await rm(legacy, { recursive: true, force: true });
    }
    await connection.client`
      insert into guild_config (guild_id,channel_id,setup_complete,enabled,target_type,monitored_user_id,threshold,window_seconds,cooldown_seconds)
      values (${guild},'200000000000000001',true,true,'user','300000000000000001',3,120,45),
             (${other},'200000000000000002',true,true,'user','300000000000000002',5,300,90)
    `;
    await connection.client`insert into guild_channel (guild_id,channel_id) values (${guild},'200000000000000001')`;
    await connection.client`insert into guild_monitored_user (guild_id,user_id) values (${guild},'300000000000000001')`;
    await connection.client`insert into guild_monitored_role (guild_id,role_id) values (${guild},'400000000000000001')`;
    await connection.client`insert into user_persona (guild_id,user_id,description) values (${guild},'300000000000000001','Coffee critic')`;
    before =
      await connection.client`select to_jsonb(t) as config from guild_config t order by guild_id`;
    await runMigrations(connection.client, migrations);
  }, 30_000);
  afterAll(async () => {
    await connection?.close();
  });

  it("preserves populated legacy configurations and defaults direct off", async () => {
    const after =
      await connection.client`select to_jsonb(t) - 'direct_responses_enabled' - 'direct_cooldown_seconds' as config from guild_config t order by guild_id`;
    expect(after).toEqual(before);
    expect(
      (await repository.getGuildConfig(guild))?.directResponsesEnabled,
    ).toBe(false);
    expect(
      (await repository.getGuildConfig(other))?.directCooldownSeconds,
    ).toBe(30);
    expect(await repository.getGuildChannelIds(guild)).toEqual([
      "200000000000000001",
    ]);
    expect(await repository.getGuildMonitoredUserIds(guild)).toEqual([
      "300000000000000001",
    ]);
    expect(await repository.getGuildMonitoredRoleIds(guild)).toEqual([
      "400000000000000001",
    ]);
    expect(
      (await repository.getUserPersona(guild, "300000000000000001"))
        ?.description,
    ).toBe("Coffee critic");
  });
  it("can run migrations again without changing rows", async () => {
    const old = await repository.getGuildConfig(guild);
    await runMigrations(connection.client, migrations);
    expect(await repository.getGuildConfig(guild)).toEqual(old);
  });
  it("updates only direct settings, audits changes, and isolates guilds", async () => {
    const old = await repository.getGuildConfig(guild);
    expect(
      await repository.configureGuild({
        actorUserId: "300000000000000001",
        guildId: guild,
        update: { directResponsesEnabled: true, directCooldownSeconds: 10 },
      }),
    ).toBe(true);
    const fresh = await repository.getGuildConfig(guild);
    expect(fresh?.threshold).toBe(old?.threshold);
    expect(fresh?.cooldownSeconds).toBe(old?.cooldownSeconds);
    expect(fresh?.directResponsesEnabled).toBe(true);
    expect(
      (await repository.getGuildConfig(other))?.directResponsesEnabled,
    ).toBe(false);
    const audit =
      await connection.client`select command_name from admin_audit_event where guild_id=${guild}`;
    expect(audit[0]?.command_name).toBe("configure");
  });
  it("checks cooldown bounds in both repository and database", async () => {
    await expect(
      repository.configureGuild({
        actorUserId: "1",
        guildId: guild,
        update: { directCooldownSeconds: -1 },
      }),
    ).rejects.toThrow();
    await expect(
      connection.client`update guild_config set direct_cooldown_seconds=3601 where guild_id=${guild}`,
    ).rejects.toThrow();
    expect(
      await repository.configureGuild({
        actorUserId: "1",
        guildId: "unconfigured",
        update: { directResponsesEnabled: true },
      }),
    ).toBe(false);
  });
  it("saves mixed settings together and rejects invalid mixed updates without mutation", async () => {
    const otherBefore = await repository.getGuildConfig(other);
    expect(
      await repository.configureGuild({
        actorUserId: "1",
        guildId: guild,
        update: {
          cooldownSeconds: 60,
          directCooldownSeconds: 0,
          directResponsesEnabled: false,
        },
      }),
    ).toBe(true);
    const fresh = await repository.getGuildConfig(guild);
    expect(fresh).toMatchObject({
      cooldownSeconds: 60,
      directCooldownSeconds: 0,
      directResponsesEnabled: false,
    });
    const auditBefore =
      await connection.client`select * from admin_audit_event where guild_id=${guild} order by created_at,id`;
    expect(auditBefore).toHaveLength(2);
    expect(auditBefore[1]?.change).toEqual({
      cooldownSeconds: 60,
      directCooldownSeconds: 0,
      directResponsesEnabled: false,
    });
    await expect(
      repository.configureGuild({
        actorUserId: "1",
        guildId: guild,
        update: { threshold: 6, directCooldownSeconds: 3601 },
      }),
    ).rejects.toThrow();
    expect(await repository.getGuildConfig(guild)).toEqual(fresh);
    expect(
      await connection.client`select * from admin_audit_event where guild_id=${guild} order by created_at,id`,
    ).toEqual(auditBefore);
    expect(await repository.getGuildConfig(other)).toEqual(otherBefore);
  });
  it("does not configure a guild whose setup is incomplete", async () => {
    const incomplete = "100000000000000003";
    await connection.client`insert into guild_config (guild_id) values (${incomplete})`;
    expect(
      await repository.configureGuild({
        actorUserId: "1",
        guildId: incomplete,
        update: { directResponsesEnabled: true },
      }),
    ).toBe(false);
    expect(
      (await repository.getGuildConfig(incomplete))?.directResponsesEnabled,
    ).toBe(false);
    expect(
      await connection.client`select * from admin_audit_event where guild_id=${incomplete}`,
    ).toHaveLength(0);
  });
  it("handles zero quota before first insert and atomic concurrent limits", async () => {
    const now = new Date("2026-08-30T12:00:00Z");
    expect(await repository.tryReserveDirectGeneration(guild, 0, now)).toBe(
      false,
    );
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        repository.tryReserveDirectGeneration(guild, 3, now),
      ),
    );
    expect(attempts.filter(Boolean)).toHaveLength(3);
    expect(await repository.tryReserveDirectGeneration(guild, 0, now)).toBe(
      false,
    );
    expect(await repository.tryReserveLlmGeneration(guild, 1, now)).toBe(true);
    expect(await repository.tryReserveLlmGeneration(guild, 1, now)).toBe(false);
    expect(await repository.tryReserveDirectGeneration(other, 1, now)).toBe(
      true,
    );
    expect(
      await repository.tryReserveDirectGeneration(
        guild,
        1,
        new Date("2026-08-31T00:00:00Z"),
      ),
    ).toBe(true);
  });
});
