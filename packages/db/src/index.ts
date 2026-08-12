import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { schema } from "./schema.js";

export * from "./migrations.js";
export * from "./repository.js";
export * from "./schema.js";

export function createDatabaseConnection(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    prepare: false,
  });

  return {
    client,
    close: () => client.end({ timeout: 5 }),
    database: drizzle(client, { schema }),
  };
}

export type DatabaseConnection = ReturnType<typeof createDatabaseConnection>;
