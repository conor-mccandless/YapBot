import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnvironment } from "@yapbot/config";
import { buildDirectContext } from "../src/direct-context.js";
import {
  createDirectModelRequest,
  DIRECT_INSTRUCTIONS,
} from "../src/direct-generator.js";
import { bot, history, request } from "./direct-fixtures.js";

const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create: provider.create };
  },
}));

beforeEach(() => {
  provider.create.mockReset().mockResolvedValue({
    status: "completed",
    output_text: "Coffee isn't lunch.",
  });
});

describe("direct provider budget", () => {
  it.each([1200, 1600])(
    "sends the independent %s-token direct budget",
    async (budget) => {
      const environment = parseEnvironment({
        ALLOWED_GUILD_IDS: "12345678901234567",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        DISCORD_APPLICATION_ID: "12345678901234567",
        DISCORD_TOKEN: "test-token",
        OPENAI_API_KEY: "test-openai-key",
        OPENAI_MAX_OUTPUT_TOKENS: "900",
        OPENAI_DIRECT_MAX_OUTPUT_TOKENS: String(budget),
      });
      const model = createDirectModelRequest(environment)!;
      await model(
        buildDirectContext(request("what's going on?"), history, bot.id),
      );
      expect(provider.create).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: DIRECT_INSTRUCTIONS,
          max_output_tokens: budget,
          model: environment.OPENAI_MODEL,
          reasoning: { effort: "low" },
          store: false,
        }),
      );
      expect(environment.OPENAI_MAX_OUTPUT_TOKENS).toBe(900);
    },
  );
});
