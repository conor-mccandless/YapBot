import { describe, expect, it } from "vitest";
import {
  DirectInteractionLimiter,
  selectInteractionLane,
} from "../src/direct.js";

describe("direct admission", () => {
  const event = {
    guildId: "g",
    userId: "u",
    messageId: "1",
    nowMs: 1_000,
    cooldownSeconds: 30,
  };
  it.each([
    [false, false, "passive_threshold"],
    [false, true, "passive_threshold"],
    [true, false, "passive_threshold"],
    [true, true, "direct"],
  ] as const)("routes enabled=%s addressed=%s", (enabled, addressed, lane) => {
    expect(selectInteractionLane(enabled, addressed)).toBe(lane);
  });
  it("reserves atomically and blocks duplicates, concurrent work and user cooldown", () => {
    const limiter = new DirectInteractionLimiter();
    const first = limiter.acquire(event);
    expect(first.outcome).toBe("admitted");
    if (first.outcome !== "admitted") throw new Error("not admitted");
    expect(limiter.acquire(event).outcome).toBe("duplicate");
    expect(
      limiter.acquire({ ...event, messageId: "2", nowMs: 20_000 }).outcome,
    ).toBe("in_flight");
    limiter.finish(first.ticket);
    expect(
      limiter.acquire({ ...event, messageId: "3", nowMs: 20_000 }).outcome,
    ).toBe("user_cooldown");
  });
  it("separates guild guard and requesters, including zero user cooldown", () => {
    const limiter = new DirectInteractionLimiter();
    expect(limiter.acquire({ ...event, cooldownSeconds: 0 }).outcome).toBe(
      "admitted",
    );
    expect(
      limiter.acquire({ ...event, userId: "v", messageId: "2" }).outcome,
    ).toBe("guild_guard");
    expect(
      limiter.acquire({ ...event, userId: "v", messageId: "3", nowMs: 6_000 })
        .outcome,
    ).toBe("admitted");
    expect(limiter.acquire({ ...event, guildId: "other" }).outcome).toBe(
      "admitted",
    );
  });
  it("invalidates pending sends without unlocking still-running work", () => {
    const limiter = new DirectInteractionLimiter();
    const first = limiter.acquire(event);
    if (first.outcome !== "admitted") throw new Error("not admitted");
    limiter.clearGuild("g");
    expect(limiter.isCurrent(first.ticket)).toBe(false);
    expect(limiter.acquire({ ...event, messageId: "2" }).outcome).toBe(
      "in_flight",
    );
    limiter.finish(first.ticket);
    expect(limiter.acquire({ ...event, messageId: "3" }).outcome).toBe(
      "admitted",
    );
  });
  it("expires dedup entries after a bounded interval", () => {
    const limiter = new DirectInteractionLimiter();
    const first = limiter.acquire(event);
    if (first.outcome === "admitted") limiter.finish(first.ticket);
    expect(limiter.acquire({ ...event, nowMs: 400_000 }).outcome).toBe(
      "admitted",
    );
  });
});
