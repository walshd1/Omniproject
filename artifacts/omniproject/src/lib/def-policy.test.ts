import { describe, it, expect } from "vitest";
import { canWriteDefScope, writableDefScopes, type DefScopePolicy } from "./def-policy";

/**
 * Client mirror of the server def-policy (roadmap X.12): who may author a def at each scope. The server stays
 * authoritative; this only decides which targets the UI OFFERS. Includes the `programme` scope (X.13 rung).
 */
const DEFAULTS: DefScopePolicy = { user: "contributor", project: "manager", programme: "programmeManager", org: "pmoOrAdmin" };

describe("canWriteDefScope", () => {
  it("gates each rung by the caller's role", () => {
    expect(canWriteDefScope("contributor", "contributor")).toBe(true);
    expect(canWriteDefScope("contributor", "programmeManager")).toBe(false);
    expect(canWriteDefScope("programmeManager", "programmeManager")).toBe(true);
    expect(canWriteDefScope("manager", "programmeManager")).toBe(false); // a plain PM is below the rung
    expect(canWriteDefScope("pmo", "programmeManager")).toBe(true);       // authorities sit above it
    expect(canWriteDefScope("programmeManager", "pmoOrAdmin")).toBe(false);
  });
});

describe("writableDefScopes", () => {
  it("offers programme only to a programmeManager+ (and always the lower scopes they clear)", () => {
    expect(writableDefScopes("contributor", DEFAULTS)).toEqual(["user"]);
    expect(writableDefScopes("manager", DEFAULTS)).toEqual(["user", "project"]);
    expect(writableDefScopes("programmeManager", DEFAULTS)).toEqual(["user", "project", "programme"]);
    // pmo/admin clear every scope including org.
    expect(writableDefScopes("admin", DEFAULTS)).toEqual(["user", "project", "programme", "org"]);
  });

  it("falls back to sane defaults when the policy isn't loaded", () => {
    expect(writableDefScopes("programmeManager", undefined)).toContain("programme");
    expect(writableDefScopes("contributor", undefined)).toEqual(["user"]);
  });
});
