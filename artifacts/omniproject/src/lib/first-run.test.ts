import { describe, it, expect, beforeEach } from "vitest";
import { shouldGateToSetup, firstRunDismissed, dismissFirstRun } from "./first-run";

/** The first-run gate predicate + its per-browser dismiss flag. */

describe("shouldGateToSetup", () => {
  const base = { role: "admin" as const, brokerConfigured: false, dismissed: false, segment: "" };

  it("gates an admin on the landing page of an unconfigured instance", () => {
    expect(shouldGateToSetup(base)).toBe(true);
    expect(shouldGateToSetup({ ...base, segment: "home" })).toBe(true);
    expect(shouldGateToSetup({ ...base, role: "pmo" })).toBe(true);
  });

  it("does NOT gate once a backend is configured", () => {
    expect(shouldGateToSetup({ ...base, brokerConfigured: true })).toBe(false);
  });

  it("does NOT gate a non-admin (they can't act on the wizard anyway)", () => {
    expect(shouldGateToSetup({ ...base, role: "contributor" })).toBe(false);
    expect(shouldGateToSetup({ ...base, role: "viewer" })).toBe(false);
    expect(shouldGateToSetup({ ...base, role: undefined })).toBe(false);
  });

  it("does NOT gate once dismissed, or when mid-app (not the landing page)", () => {
    expect(shouldGateToSetup({ ...base, dismissed: true })).toBe(false);
    expect(shouldGateToSetup({ ...base, segment: "projects" })).toBe(false);
    expect(shouldGateToSetup({ ...base, segment: "configurator" })).toBe(false);
  });
});

describe("dismiss flag (localStorage)", () => {
  beforeEach(() => localStorage.clear());
  it("starts undismissed and remembers a dismiss", () => {
    expect(firstRunDismissed()).toBe(false);
    dismissFirstRun();
    expect(firstRunDismissed()).toBe(true);
  });
});
