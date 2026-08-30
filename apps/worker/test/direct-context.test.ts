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
        msg("old", "old", freddy, { createdAtMs: 1 }),
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
    const old = msg("old", "Coffee rollout", bot, { createdAtMs: 1 });
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
    expect(context.recentConversation.length).toBeLessThanOrEqual(25);
    expect(context.recentConversation.some((m) => m.id === "f")).toBe(true);
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
