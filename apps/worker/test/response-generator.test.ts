import { describe, expect, it, vi } from "vitest";

import {
  buildOpenAIContent,
  buildOpenAIInput,
  sanitizeGeneratedResponse,
  selectOpenAIModel,
  YAPBOT_INSTRUCTIONS,
  YapResponseGenerator,
} from "../src/response-generator.js";

describe("YapResponseGenerator", () => {
  it("returns a sanitized OpenAI response when generation succeeds", async () => {
    const request = vi.fn().mockResolvedValue("  Keep   yapping, @everyone!  ");
    const generator = new YapResponseGenerator(request, () => "fallback");

    await expect(
      generator.generate("hello", true, "Works at a library."),
    ).resolves.toEqual({
      content: "Keep yapping, @\u200beveryone!",
      source: "openai",
    });
    expect(request).toHaveBeenCalledWith({
      messageContent: "hello",
      persona: "Works at a library.",
    });
  });

  it("passes trigger metadata to the OpenAI request", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        "The archive is busy today. Let the channel catch its breath before volume four.",
      );
    const generator = new YapResponseGenerator(request, () => "fallback");
    const trigger = {
      messageCount: 3,
      threshold: 3,
      windowSeconds: 30,
    };

    await generator.generate(
      "Another important update.",
      true,
      "Works at a library.",
      [],
      trigger,
    );

    expect(request).toHaveBeenCalledWith({
      messageContent: "Another important update.",
      persona: "Works at a library.",
      trigger,
    });
  });

  it("passes the complete ordered threshold context to the OpenAI request", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        "A three-part bulletin has been duly received. Give the channel a moment before issuing the sequel.",
      );
    const generator = new YapResponseGenerator(request, () => "fallback");
    const messageContext = [
      { channelId: "channel-1", content: "First important update." },
      { channelId: "channel-2", content: "A related development." },
      { channelId: "channel-1", content: "Final confirmation." },
    ];

    await generator.generate(
      "Final confirmation.",
      true,
      undefined,
      [],
      undefined,
      messageContext,
    );

    expect(request).toHaveBeenCalledWith({
      messageContent: "Final confirmation.",
      messageContext,
    });
  });

  it("can generate when an earlier threshold message has text and the final message does not", async () => {
    const request = vi.fn().mockResolvedValue("The sequence is complete.");
    const generator = new YapResponseGenerator(request, () => "fallback");

    await expect(
      generator.generate("", true, undefined, [], undefined, [
        { channelId: "channel-1", content: "Earlier context." },
        { channelId: "channel-1", content: "" },
      ]),
    ).resolves.toEqual({
      content: "The sequence is complete.",
      source: "openai",
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("uses static fallback when OpenAI is unavailable", async () => {
    const generator = new YapResponseGenerator(undefined, () => "fallback");

    await expect(generator.generate("hello", true)).resolves.toEqual({
      content: "fallback",
      fallbackReason: "not_configured",
      source: "static",
    });
  });

  it("uses static fallback when the daily limit is exhausted", async () => {
    const request = vi.fn();
    const generator = new YapResponseGenerator(request, () => "fallback");

    await expect(generator.generate("hello", false)).resolves.toEqual({
      content: "fallback",
      fallbackReason: "daily_limit",
      source: "static",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("uses static fallback for request failures and empty output", async () => {
    const failed = new YapResponseGenerator(
      vi.fn().mockRejectedValue(new Error("provider failure")),
      () => "fallback",
    );
    const empty = new YapResponseGenerator(
      vi.fn().mockResolvedValue("  "),
      () => "fallback",
    );

    await expect(failed.generate("hello", true)).resolves.toMatchObject({
      fallbackReason: "request_failed",
      source: "static",
    });
    await expect(empty.generate("hello", true)).resolves.toMatchObject({
      fallbackReason: "empty_output",
      source: "static",
    });
  });

  it("reports output-budget exhaustion separately from an ordinary empty output", async () => {
    const generator = new YapResponseGenerator(
      vi.fn().mockResolvedValue({
        incompleteReason: "max_output_tokens",
        text: "",
      }),
      () => "fallback",
    );

    await expect(generator.generate("hello", true)).resolves.toMatchObject({
      fallbackReason: "max_output_tokens",
      source: "static",
    });
  });

  it("generates from image input when the triggering message has no text", async () => {
    const request = vi.fn().mockResolvedValue("A remarkably curated disaster.");
    const generator = new YapResponseGenerator(request, () => "fallback");
    const imageDataUrls = ["data:image/png;base64,AQID"];

    await expect(
      generator.generate("", true, "Works at a library.", imageDataUrls),
    ).resolves.toEqual({
      content: "A remarkably curated disaster.",
      source: "openai",
    });
    expect(request).toHaveBeenCalledWith({
      imageDataUrls,
      messageContent: "",
      persona: "Works at a library.",
    });
  });
});

describe("buildOpenAIInput", () => {
  it("adds persona and ordered messages as untrusted request-time context", () => {
    const input = buildOpenAIInput({
      messageContent: "I know everything about archives.",
      messageContext: [
        { channelId: "channel-1", content: "The archive opens at nine." },
        {
          channelId: "channel-2",
          content: "I know everything about archives.",
        },
      ],
      persona:
        "This guy works at a library and overheard people talking about something, which makes him a subject matter expert on it.",
      trigger: {
        messageCount: 3,
        threshold: 3,
        windowSeconds: 30,
      },
    });

    expect(input).toContain("untrusted JSON");
    expect(input).toContain("works at a library");
    expect(input).toContain("The archive opens at nine.");
    expect(input).toContain("I know everything about archives.");
    expect(input).toContain('"triggeringMessageSequence":2');
    expect(input).toContain(
      '"trigger":{"messageCount":3,"threshold":3,"windowSeconds":30}',
    );
    expect(YAPBOT_INSTRUCTIONS).toContain("18 to 75 words");
    expect(YAPBOT_INSTRUCTIONS).toContain("anti-yap nudge is required");
    expect(YAPBOT_INSTRUCTIONS).not.toContain("works at a library");
  });

  it("keeps trigger context optional for backwards-compatible callers", () => {
    const input = buildOpenAIInput({ messageContent: "hello" });
    const json = JSON.parse(input.split("\n").at(-1) ?? "{}") as {
      trigger: unknown;
    };

    expect(json.trigger).toBeNull();
  });

  it("bounds persona and message content", () => {
    const input = buildOpenAIInput({
      messageContent: "m".repeat(2_100),
      persona: "p".repeat(600),
    });
    const json = JSON.parse(input.split("\n").at(-1) ?? "{}") as {
      discordMessages: Array<{ content: string }>;
      personaBackground: string;
    };

    expect(json.personaBackground).toHaveLength(500);
    expect(json.discordMessages[0]?.content).toHaveLength(2_000);
  });
});

describe("selectOpenAIModel", () => {
  it("uses the optional image model only for multimodal requests", () => {
    expect(
      selectOpenAIModel(
        { messageContent: "hello" },
        "gpt-5.6-luna",
        "gpt-5.6-terra",
      ),
    ).toBe("gpt-5.6-luna");
    expect(
      selectOpenAIModel(
        {
          imageDataUrls: ["data:image/png;base64,AQID"],
          messageContent: "",
        },
        "gpt-5.6-luna",
        "gpt-5.6-terra",
      ),
    ).toBe("gpt-5.6-terra");
  });

  it("falls back to the text model when no image model is configured", () => {
    expect(
      selectOpenAIModel(
        {
          imageDataUrls: ["data:image/png;base64,AQID"],
          messageContent: "",
        },
        "gpt-5.6-luna",
      ),
    ).toBe("gpt-5.6-luna");
  });
});

describe("buildOpenAIContent", () => {
  it("keeps text-only requests backwards compatible", () => {
    const content = buildOpenAIContent({ messageContent: "hello" });

    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "input_text" });
  });

  it("adds multimodal image items after the untrusted text context", () => {
    const content = buildOpenAIContent({
      imageDataUrls: ["data:image/png;base64,AQID"],
      messageContent: "",
      persona: "Works at a library.",
    });

    expect(content).toEqual([
      expect.objectContaining({ type: "input_text" }),
      {
        detail: "auto",
        image_url: "data:image/png;base64,AQID",
        type: "input_image",
      },
    ]);
  });
});

describe("sanitizeGeneratedResponse", () => {
  it("bounds output length and neutralizes Discord mentions", () => {
    const value = `${"x".repeat(510)} @here`;
    const sanitized = sanitizeGeneratedResponse(value);

    expect(sanitized.length).toBe(500);
    expect(sanitized).not.toContain("@here");
  });
});
