import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../src/index.js";

const validEnvironment = {
  ALLOWED_GUILD_IDS: "12345678901234567, 22345678901234567",
  DATABASE_URL: "postgresql://yapbot:yapbot_dev@localhost:5432/yapbot",
  DISCORD_APPLICATION_ID: "32345678901234567",
  DISCORD_TOKEN: "test-token",
};

describe("parseEnvironment", () => {
  it("parses defaults and approved guild IDs", () => {
    const result = parseEnvironment(validEnvironment);

    expect(result.ALLOWED_GUILD_IDS).toEqual([
      "12345678901234567",
      "22345678901234567",
    ]);
    expect(result.LOG_LEVEL).toBe("info");
    expect(result.NODE_ENV).toBe("development");
    expect(result.OPENAI_DAILY_GUILD_LIMIT).toBe(100);
    expect(result.OPENAI_MAX_OUTPUT_TOKENS).toBe(400);
    expect(result.OPENAI_IMAGE_MODEL).toBeUndefined();
    expect(result.OPENAI_MODEL).toBe("gpt-5.6-luna");
    expect(result.OPENAI_REASONING_EFFORT).toBe("low");
    expect(result.OPENAI_TIMEOUT_MS).toBe(10_000);
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  it("accepts an OpenAI key and numeric generation settings", () => {
    const result = parseEnvironment({
      ...validEnvironment,
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_DAILY_GUILD_LIMIT: "25",
      OPENAI_IMAGE_MODEL: "gpt-5.6-terra",
      OPENAI_MAX_OUTPUT_TOKENS: "80",
      OPENAI_REASONING_EFFORT: "medium",
      OPENAI_TIMEOUT_MS: "5000",
    });

    expect(result.OPENAI_API_KEY).toBe("test-openai-key");
    expect(result.OPENAI_DAILY_GUILD_LIMIT).toBe(25);
    expect(result.OPENAI_IMAGE_MODEL).toBe("gpt-5.6-terra");
    expect(result.OPENAI_MAX_OUTPUT_TOKENS).toBe(80);
    expect(result.OPENAI_REASONING_EFFORT).toBe("medium");
    expect(result.OPENAI_TIMEOUT_MS).toBe(5_000);
  });

  it("treats a blank OpenAI key as disabled", () => {
    expect(
      parseEnvironment({ ...validEnvironment, OPENAI_API_KEY: "" })
        .OPENAI_API_KEY,
    ).toBeUndefined();
  });

  it("rejects an empty approved-guild list", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, ALLOWED_GUILD_IDS: "" }),
    ).toThrow();
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        DATABASE_URL: "https://example.com",
      }),
    ).toThrow();
  });
});
