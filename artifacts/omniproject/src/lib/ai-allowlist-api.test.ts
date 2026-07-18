import { describe, it, expect } from "vitest";
import { providerSelectable } from "./ai-allowlist-api";

describe("providerSelectable (AI provider allowlist picker filter)", () => {
  it("permits everything when unrestricted (null)", () => {
    expect(providerSelectable("openai", null)).toBe(true);
    expect(providerSelectable("anthropic", null)).toBe(true);
  });

  it("permits only allowlisted providers when restricted", () => {
    expect(providerSelectable("anthropic", ["anthropic"])).toBe(true);
    expect(providerSelectable("openai", ["anthropic"])).toBe(false);
  });

  it("always permits \"none\" (AI off), even under a restrictive allowlist", () => {
    expect(providerSelectable("none", [])).toBe(true);
    expect(providerSelectable("none", ["anthropic"])).toBe(true);
  });
});
