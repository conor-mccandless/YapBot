import { describe, expect, it } from "vitest";

import { KeyedMutex, RollingTriggerDetector } from "../src/index.js";

const baseInput = {
  cooldownSeconds: 10,
  guildId: "guild-1",
  threshold: 3,
  userId: "user-1",
  windowSeconds: 30,
};

describe("RollingTriggerDetector", () => {
  it("triggers at the threshold and observes cooldown", () => {
    const detector = new RollingTriggerDetector();

    expect(detector.evaluate({ ...baseInput, nowMs: 0 }).outcome).toBe(
      "below_threshold",
    );
    expect(detector.evaluate({ ...baseInput, nowMs: 1_000 }).outcome).toBe(
      "below_threshold",
    );
    expect(detector.evaluate({ ...baseInput, nowMs: 2_000 })).toEqual({
      count: 3,
      outcome: "trigger",
    });
    expect(detector.evaluate({ ...baseInput, nowMs: 3_000 }).outcome).toBe(
      "cooldown",
    );
    expect(detector.evaluate({ ...baseInput, nowMs: 12_000 }).outcome).toBe(
      "trigger",
    );
  });

  it("prunes events outside the rolling window", () => {
    const detector = new RollingTriggerDetector();

    detector.evaluate({ ...baseInput, nowMs: 0 });
    detector.evaluate({ ...baseInput, nowMs: 1_000 });

    expect(detector.evaluate({ ...baseInput, nowMs: 30_001 })).toEqual({
      count: 2,
      outcome: "below_threshold",
    });
  });

  it("clears guild state and evicts inactive entries", () => {
    const detector = new RollingTriggerDetector();
    detector.evaluate({ ...baseInput, nowMs: 0 });
    detector.evaluate({ ...baseInput, guildId: "guild-2", nowMs: 0 });

    detector.clearGuild("guild-1");
    expect(detector.size).toBe(1);
    expect(detector.sweep(31_000, 30)).toBe(1);
    expect(detector.size).toBe(0);
  });
});

describe("KeyedMutex", () => {
  it("serializes tasks sharing a key", async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = mutex.runExclusive("same", async () => {
      events.push("first-start");
      await firstGate;
      events.push("first-end");
    });
    const second = mutex.runExclusive("same", async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });
});
