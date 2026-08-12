import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type postgres from "postgres";

const MIGRATION_LOCK_ID = 2_714_828_182;

export async function runMigrations(
  client: postgres.Sql,
  migrationsDirectory: string,
): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();

  await client.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;
    await transaction.unsafe(`
      create table if not exists yapbot_schema_migration (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    for (const filename of migrationFiles) {
      const sqlText = await readFile(
        path.join(migrationsDirectory, filename),
        "utf8",
      );
      const checksum = createHash("sha256").update(sqlText).digest("hex");
      const [existing] = await transaction<
        { checksum: string }[]
      >`select checksum from yapbot_schema_migration where filename = ${filename}`;

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(
            `Migration checksum changed after application: ${filename}`,
          );
        }
        continue;
      }

      await transaction.unsafe(sqlText);
      await transaction`
        insert into yapbot_schema_migration (filename, checksum)
        values (${filename}, ${checksum})
      `;
    }
  });
}
