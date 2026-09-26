import { describe, expect, it, vi } from "vitest";
import { buildDirectContext } from "../src/direct-context.js";
import { isGeneratedResponseWithinLimits } from "../src/response-generator.js";
import {
  buildDirectInput,
  DIRECT_INSTRUCTIONS,
  DIRECT_MAX_RESPONSE_CHARACTERS,
  DIRECT_MAX_RESPONSE_WORDS,
  generateDirectResponse,
  validateDirectResponse,
} from "../src/direct-generator.js";
import { bot, history, request } from "./direct-fixtures.js";

describe("direct response contract", () => {
  const context = buildDirectContext(
    request("what's going on?"),
    history,
    bot.id,
  );
  it("accepts an organic one-sentence response with no slowdown keyword", async () => {
    const model = vi.fn().mockResolvedValue({
      status: "completed",
      text: "Freddy promoted coffee to a food group and Steve isn't buying it.",
    });
    expect((await generateDirectResponse(context, model, true)).source).toBe(
      "openai",
    );
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("does not inherit passive instructions and keeps untrusted evidence in structured input", () => {
    expect(DIRECT_INSTRUCTIONS).toContain("not a rapid-posting trigger");
    expect(DIRECT_INSTRUCTIONS).toContain("untrusted content");
    const input = JSON.parse(buildDirectInput(context));
    expect(input.request.id).toBe("r");
    expect(input.recentConversation).toHaveLength(2);
    expect(input.subjectPersonas).toEqual([]);
  });
  it("neutralizes mentions and does not impose sentence count", async () => {
    const model = vi.fn().mockResolvedValue({
      status: "completed",
      text: "<@123> @everyone Coffee isn't lunch",
    });
    const output = await generateDirectResponse(context, model, true);
    expect(output.content).not.toContain("@everyone");
    expect(output.content).not.toContain("<@123>");
    expect(validateDirectResponse("Coffee isn't lunch")).toEqual([]);
  });
  it("corrects only structural failures once", async () => {
    const model = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        text: "x".repeat(DIRECT_MAX_RESPONSE_CHARACTERS + 1),
      })
      .mockResolvedValueOnce({
        status: "completed",
        text: "Coffee isn't lunch.",
      });
    expect((await generateDirectResponse(context, model, true)).source).toBe(
      "openai",
    );
    expect(model.mock.calls[1]?.[1]).toBe("output_too_long");
  });
  it("accepts longer direct explanations without relaxing passive limits", async () => {
    const text = "The argument is about whether coffee counts as a meal. "
      .repeat(8)
      .trim();
    expect(text.split(/\s+/u).length).toBeGreaterThan(75);
    expect(validateDirectResponse(text)).toEqual([]);
    expect(isGeneratedResponseWithinLimits(text)).toBe(false);
    const model = vi.fn().mockResolvedValue({ status: "completed", text });
    expect((await generateDirectResponse(context, model, true)).source).toBe(
      "openai",
    );
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("enforces the new word and character boundaries independently", () => {
    expect(DIRECT_MAX_RESPONSE_WORDS).toBe(150);
    expect(DIRECT_MAX_RESPONSE_CHARACTERS).toBe(1200);
    expect(validateDirectResponse(Array(150).fill("word").join(" "))).toEqual(
      [],
    );
    expect(validateDirectResponse(Array(151).fill("word").join(" "))).toEqual([
      "output_too_long",
    ]);
    expect(validateDirectResponse("x".repeat(1200))).toEqual([]);
    expect(validateDirectResponse("x".repeat(1201))).toEqual([
      "output_too_long",
    ]);
  });
  it("asks for absent evidence without turning empty history into a roast requirement", () => {
    expect(DIRECT_INSTRUCTIONS).toContain(
      "Missing, filtered, or unavailable history means you lack evidence",
    );
    expect(DIRECT_INSTRUCTIONS).toContain("Do not judge absent comments");
    expect(DIRECT_INSTRUCTIONS).toContain(
      "Still answer self-contained questions and supplied images normally",
    );
    expect(DIRECT_INSTRUCTIONS).not.toContain("one to three short sentences");
    expect(DIRECT_INSTRUCTIONS).toContain("150 words and 1200 characters");
  });
  it("bounds retries and captures response diagnostics", async () => {
    const model = vi.fn().mockResolvedValue({ status: "completed", text: "" });
    const diagnose = vi.fn();
    expect(
      (await generateDirectResponse(context, model, true, diagnose)).reason,
    ).toBe("invalid_output");
    expect(model).toHaveBeenCalledTimes(2);
    expect(diagnose).toHaveBeenCalledTimes(4);
  });
  it("fails closed for incomplete output and provider errors", async () => {
    const model = vi.fn().mockResolvedValue({
      status: "incomplete",
      text: "Half a",
      incompleteReason: "max_output_tokens",
    });
    expect((await generateDirectResponse(context, model, true)).reason).toBe(
      "provider_incomplete",
    );
    expect(model).toHaveBeenCalledTimes(1);
    expect(
      (
        await generateDirectResponse(
          context,
          vi.fn().mockRejectedValue(new Error("offline")),
          true,
        )
      ).reason,
    ).toBe("request_failed");
  });
  it("uses direct-only unavailable/quota/clarification fallbacks without calling the model", async () => {
    const model = vi.fn();
    expect((await generateDirectResponse(context, model, false)).reason).toBe(
      "daily_limit",
    );
    expect(
      (await generateDirectResponse(context, undefined, false)).reason,
    ).toBe("not_configured");
    expect(
      (
        await generateDirectResponse(
          {
            ...context,
            subjectResolution: {
              method: "ambiguous",
              subjects: [],
              ambiguousNames: ["freddy"],
            },
          },
          model,
          true,
        )
      ).reason,
    ).toBe("ambiguous_subject");
    expect(model).not.toHaveBeenCalled();
  });
});
