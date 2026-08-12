import { describe, expect, it } from "vitest";

import { STATIC_RESPONSES, selectStaticResponse } from "../src/responses.js";

describe("selectStaticResponse", () => {
  it("selects deterministic pool boundaries", () => {
    expect(selectStaticResponse(() => 0)).toBe(STATIC_RESPONSES[0]);
    expect(selectStaticResponse(() => 0.999_999)).toBe(STATIC_RESPONSES.at(-1));
  });

  it("contains no Discord mention syntax", () => {
    expect(STATIC_RESPONSES.every((response) => !response.includes("@"))).toBe(
      true,
    );
  });
});
