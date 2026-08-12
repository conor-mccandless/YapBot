import { describe, expect, it } from "vitest";

import {
  DEFAULT_BEHAVIOR_CONFIG,
  validateBehaviorConfig,
} from "../src/index.js";

describe("validateBehaviorConfig", () => {
  it("accepts the v1 defaults", () => {
    expect(validateBehaviorConfig(DEFAULT_BEHAVIOR_CONFIG)).toEqual([]);
  });

  it("rejects non-integer and out-of-range values", () => {
    expect(
      validateBehaviorConfig({
        ...DEFAULT_BEHAVIOR_CONFIG,
        cooldownSeconds: -1,
        threshold: 2.5,
        windowSeconds: 3_601,
      }),
    ).toEqual([
      "threshold is outside the supported range",
      "windowSeconds is outside the supported range",
      "cooldownSeconds is outside the supported range",
    ]);
  });
});
