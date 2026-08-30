import { describe, expect, it } from "vitest";
import {
  buildDirectContext,
  directMediaCandidates,
  resolveSubjects,
} from "../src/direct-context.js";
import {
  bot,
  freddy,
  steve,
  history,
  msg,
  request,
} from "./direct-fixtures.js";

describe("direct subject resolution", () => {
  it.each([
    "Freddy",
    "freddy",
    "Freddy's",
    "Freddy’s",
    "freddys",
    "fredrichnietze",
  ])("resolves %s without a mention", (name) => {
    expect(
      resolveSubjects(
        request(`@YapBot what do you think about ${name} comments?`),
        history,
        bot.id,
      ),
    ).toMatchObject({ method: "plain_name", subjects: [freddy] });
  });
  it("uses explicit mentions over a different replied-to author", () => {
    expect(
      resolveSubjects(
        request("@YapBot what about <@fred-id>?", { mentions: [freddy, bot] }),
        history,
        bot.id,
        history[1],
      ),
    ).toMatchObject({ method: "mention", subjects: [freddy] });
  });
  it("uses reply evidence for this person and named subjects over replies", () => {
    expect(
      resolveSubjects(
        request("what is this person talking about?"),
        history,
        bot.id,
        history[0],
      ).subjects,
    ).toEqual([freddy]);
    expect(
      resolveSubjects(request("what about Steve?"), history, bot.id, history[0])
        .subjects,
    ).toEqual([steve]);
  });
  it("allows multiple named subjects", () => {
    expect(
      resolveSubjects(
        request("Freddy or Steve, who makes sense?"),
        history,
        bot.id,
      )
        .subjects.map((p) => p.id)
        .sort(),
    ).toEqual([freddy.id, steve.id].sort());
  });
  it("clarifies duplicate names rather than selecting the latest speaker", () => {
    const otherFreddy = msg("ff", "no", { ...steve, displayName: "Freddy" });
    expect(
      resolveSubjects(
        request("what is Freddy saying?"),
        [...history, otherFreddy],
        bot.id,
      ),
    ).toMatchObject({ method: "ambiguous", subjects: [] });
  });
  it("does not invent a subject for unknown names or generic recaps", () => {
    for (const q of [
      "what is George saying?",
      "what's going on in here?",
      "this person?",
      "Freddyman?",
      "will you recap?",
    ]) {
      expect(
        resolveSubjects(
          request(q),
          [
            ...history,
            msg("w", "hey", {
              ...steve,
              username: "will",
              displayName: "Will",
            }),
          ],
          bot.id,
        ).method,
      ).toBe("none");
    }
  });
  it("prefers a full display name over an overlapping short name", () => {
    const long = { ...steve, displayName: "Freddy Mercury" };
    expect(
      resolveSubjects(
        request("Freddy Mercury what a take"),
        [history[0]!, msg("long", "hi", long)],
        bot.id,
      ).subjects,
    ).toEqual([long]);
  });
});

describe("bounded channel evidence", () => {
  it("filters other scopes, bots, system, old/future and duplicate messages", () => {
    const context = buildDirectContext(
      request("what's going on?"),
      [
        ...history,
        history[0]!,
        msg("bot", "do this", bot),
        msg("foreign", "secret", freddy, { channelId: "other" }),
        msg("guild", "secret", freddy, { guildId: "other" }),
        msg("old", "old", freddy, {
          createdAtMs: request("").createdAtMs - 10_801_000,
        }),
        msg("future", "new", steve, { createdAtMs: 500_000 }),
        msg("system", "x", steve, { ignored: true }),
        request("what's going on?"),
      ],
      bot.id,
    );
    expect(context.recentConversation.map((m) => m.id)).toEqual(["f", "s"]);
    expect(context.subjectPersonas).toEqual([]);
  });
  it("includes one explicit older reply or referenced YapBot answer", () => {
    const old = msg("old", "Coffee rollout", bot, {
      createdAtMs: request("").createdAtMs - 10_801_000,
    });
    const context = buildDirectContext(request("why?"), history, bot.id, old);
    expect(context.repliedTo?.id).toBe("old");
    expect(context.contextLimitations.join()).toContain("older");
    expect(
      buildDirectContext(request("why?"), history, bot.id, {
        ...old,
        channelId: "other",
      }).repliedTo,
    ).toBeUndefined();
  });
  it("bounds text/messages and keeps named-subject evidence", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      msg(`m${i}`, "z".repeat(2000), steve, { createdAtMs: 401_000 + i }),
    );
    const context = buildDirectContext(
      request("Freddy " + "x".repeat(3000)),
      [...history, ...many],
      bot.id,
      msg("reply", "r".repeat(3000)),
    );
    const texts = [
      context.request,
      context.repliedTo!,
      ...context.recentConversation,
    ];
    expect(texts.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(
      20_000,
    );
    expect(texts.every((m) => m.content.length <= 2000)).toBe(true);
    expect(context.recentConversation.length).toBeLessThanOrEqual(40);
    expect(context.recentConversation.some((m) => m.id === "f")).toBe(true);
  });
  it("defaults to three hours, including the boundary but nothing older", () => {
    const now = 20_000_000;
    const context = buildDirectContext(
      request("what is Freddy saying?", { createdAtMs: now }),
      [
        msg("old", "outside the window", freddy, {
          createdAtMs: now - 10_800_001,
        }),
        msg("boundary", "still relevant", freddy, {
          createdAtMs: now - 10_800_000,
        }),
        msg("two-hours", "Coffee is a meal.", freddy, {
          createdAtMs: now - 7_200_000,
        }),
      ],
      bot.id,
    );
    expect(context.recentConversation.map((m) => m.id)).toEqual([
      "boundary",
      "two-hours",
    ]);
    expect(context.subjectResolution.subjects).toEqual([freddy]);
  });
  it("keeps forty messages when the text budget permits", () => {
    const context = buildDirectContext(
      request("what's going on?"),
      Array.from({ length: 50 }, (_, i) =>
        msg(`m${i}`, "Short update", steve, { createdAtMs: 401_000 + i }),
      ),
      bot.id,
    );
    expect(context.recentConversation).toHaveLength(40);
    expect(context.recentConversation[0]?.id).toBe("m10");
    expect(context.recentConversation[39]?.id).toBe("m49");
  });
  it("labels empty history as missing evidence, not a judgment of the subject", () => {
    const context = buildDirectContext(
      request("what is Freddy yapping about?", { mentions: [freddy] }),
      [],
      bot.id,
    );
    expect(context.subjectResolution.subjects).toEqual([freddy]);
    expect(context.recentConversation).toEqual([]);
    expect(context.contextLimitations.join(" ")).toContain("180 minutes");
    expect(context.contextLimitations.join(" ")).toContain(
      "not proof that nobody said anything",
    );
  });
  it("retains image evidence from the wider history window", () => {
    const now = 2_000_000;
    const context = buildDirectContext(
      request("what is Freddy showing us?", { createdAtMs: now }),
      [
        msg("image", "", freddy, {
          createdAtMs: now - 1_500_000,
          declaredImageCount: 1,
          images: [
            {
              contentType: "image/png",
              size: 100,
              url: "https://cdn.discordapp.com/attachments/123/456/photo.png",
            },
          ],
        }),
      ],
      bot.id,
    );
    expect(directMediaCandidates(context).map((m) => m.id)).toEqual(["image"]);
  });
  it.each([1, 60, 1440])(
    "honors a configured %s-minute window and labels empty context accurately",
    (minutes) => {
      const now = 100_000_000;
      const req = request("what is Freddy saying?", { createdAtMs: now });
      const messages = [
        msg("boundary", "Still in scope", freddy, {
          createdAtMs: now - minutes * 60_000,
        }),
        msg("old", "Out of scope", freddy, {
          createdAtMs: now - minutes * 60_000 - 1,
        }),
      ];
      const context = buildDirectContext(
        req,
        messages,
        bot.id,
        undefined,
        [],
        minutes,
      );
      expect(context.recentConversation.map((m) => m.id)).toEqual(["boundary"]);
      expect(
        buildDirectContext(
          req,
          [],
          bot.id,
          undefined,
          [],
          minutes,
        ).contextLimitations.join(),
      ).toContain(`${minutes} minutes`);
    },
  );
  it.each([0, 1441, 1.5])("rejects invalid context minutes %s", (minutes) => {
    expect(() =>
      buildDirectContext(
        request("hi"),
        history,
        bot.id,
        undefined,
        [],
        minutes,
      ),
    ).toThrow();
  });
  it("preserves media priority request, reply, then subject", () => {
    const context = buildDirectContext(
      request("Freddy https://example.com/current.png"),
      [
        msg("h", "https://example.com/earlier.png"),
        msg("s", "https://example.com/other.png", steve),
      ],
      bot.id,
      msg("reply", "https://example.com/reply.png", steve),
    );
    expect(directMediaCandidates(context).map((m) => m.id)).toEqual([
      "r",
      "reply",
      "h",
    ]);
  });
});
