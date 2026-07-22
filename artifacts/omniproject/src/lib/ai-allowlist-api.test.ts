import { describe, it, expect } from "vitest";
import { providerSelectable, modelSelectable } from "./ai-allowlist-api";

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

describe("modelSelectable (AI model allowlist picker filter)", () => {
  it("permits everything when unrestricted (null)", () => {
    expect(modelSelectable("gpt-4o", null)).toBe(true);
  });

  it("permits only allowlisted models when restricted", () => {
    expect(modelSelectable("gpt-4o", ["gpt-4o"])).toBe(true);
    expect(modelSelectable("gpt-3.5", ["gpt-4o"])).toBe(false);
  });

  it("always permits the empty / default model, even under a restrictive allowlist", () => {
    expect(modelSelectable("", [])).toBe(true);
    expect(modelSelectable("  ", ["gpt-4o"])).toBe(true);
  });
});
