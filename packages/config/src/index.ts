import { z } from "zod";

const discordSnowflakeSchema = z.string().regex(/^\d{17,20}$/, {
  message: "Expected a Discord snowflake",
});

const databaseUrlSchema = z
  .string()
  .url()
  .refine(
    (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://"),
    {
      message: "DATABASE_URL must use the postgres or postgresql protocol",
    },
  );

const optionalSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const environmentSchema = z.object({
  ALLOWED_GUILD_IDS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(discordSnowflakeSchema).min(1)),
  DATABASE_URL: databaseUrlSchema,
  DISCORD_APPLICATION_ID: discordSnowflakeSchema,
  DISCORD_TOKEN: z.string().min(1),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  OPENAI_API_KEY: optionalSecretSchema,
  OPENAI_DAILY_GUILD_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(100),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(32)
    .max(1_000)
    .default(900),
  OPENAI_IMAGE_MODEL: optionalSecretSchema,
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-luna"),
  OPENAI_REASONING_EFFORT: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("low"),
  OPENAI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: Record<string, string | undefined>,
): AppEnvironment {
  return environmentSchema.parse(environment);
}
