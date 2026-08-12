import path from "node:path";

import { createDatabaseConnection } from "./index.js";
import { runMigrations } from "./migrations.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const connection = createDatabaseConnection(databaseUrl);
  const migrationsDirectory = path.resolve(
    process.env.DB_MIGRATIONS_DIR ?? "packages/db/migrations",
  );

  try {
    await runMigrations(connection.client, migrationsDirectory);
  } finally {
    await connection.close();
  }
}

void main().catch((error: unknown) => {
  console.error("Database migration failed", error);
  process.exitCode = 1;
});
