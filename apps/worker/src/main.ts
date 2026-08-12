import { parseEnvironment } from "@yapbot/config";
import { createDatabaseConnection, YapBotRepository } from "@yapbot/db";

import { createLogger } from "./logger.js";
import { startWorker, type RunningWorker } from "./worker.js";

async function main(): Promise<void> {
  const environment = parseEnvironment(process.env);
  const logger = createLogger(environment.LOG_LEVEL);
  const database = createDatabaseConnection(environment.DATABASE_URL);
  const repository = new YapBotRepository(database);
  await database.client`select 1`;
  logger.info("PostgreSQL connection ready");
  const state: { worker?: RunningWorker } = {};
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "Shutdown requested");
    await state.worker?.stop();
    await database.close();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    state.worker = await startWorker(environment, logger, repository);
  } catch (error) {
    await database.close();
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error("YapBot worker failed to start", error);
  process.exitCode = 1;
});
