import pino, { type Logger } from "pino";

export function createLogger(level: string): Logger {
  return pino({
    base: {
      service: "yapbot-worker",
    },
    level,
    redact: {
      paths: [
        "DISCORD_TOKEN",
        "DATABASE_URL",
        "authorization",
        "req.headers.authorization",
      ],
      remove: true,
    },
  });
}
