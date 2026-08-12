import { describe, expect, it } from "vitest";

import { matchesConfiguredTarget } from "../src/targeting.js";

describe("matchesConfiguredTarget", () => {
  it("matches one specifically configured user", () => {
    const config = {
      monitoredRoleId: null,
      monitoredUserId: "user-1",
      targetType: "user",
    };

    expect(matchesConfiguredTarget(config, "user-1", () => false)).toBe(true);
    expect(matchesConfiguredTarget(config, "user-2", () => false)).toBe(false);
  });

  it("matches membership in one configured role", () => {
    const config = {
      monitoredRoleId: "role-1",
      monitoredUserId: null,
      targetType: "role",
    };

    expect(
      matchesConfiguredTarget(
        config,
        "user-1",
        (roleId) => roleId === "role-1",
      ),
    ).toBe(true);
    expect(matchesConfiguredTarget(config, "user-1", () => false)).toBe(false);
  });

  it("rejects incomplete and unknown target configurations", () => {
    expect(
      matchesConfiguredTarget(
        {
          monitoredRoleId: null,
          monitoredUserId: null,
          targetType: null,
        },
        "user-1",
        () => true,
      ),
    ).toBe(false);
  });
});
