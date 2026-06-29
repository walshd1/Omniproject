import { describe, it, expect } from "vitest";
import { isAssignedToMe } from "./MyWork";

describe("isAssignedToMe", () => {
  const me = { sub: "auth0|123", email: "ada@example.com", name: "Ada Lovelace" };

  it("matches on sub, email or name (case-insensitive)", () => {
    expect(isAssignedToMe("auth0|123", me)).toBe(true);
    expect(isAssignedToMe("ADA@EXAMPLE.COM", me)).toBe(true);
    expect(isAssignedToMe("  Ada Lovelace  ", me)).toBe(true);
  });

  it("does not match a different assignee", () => {
    expect(isAssignedToMe("someone-else", me)).toBe(false);
  });

  it("treats empty / null / undefined assignee as unassigned", () => {
    expect(isAssignedToMe(null, me)).toBe(false);
    expect(isAssignedToMe(undefined, me)).toBe(false);
    expect(isAssignedToMe("   ", me)).toBe(false);
  });

  it("never matches when the identity fields are all absent", () => {
    expect(isAssignedToMe("anyone", {})).toBe(false);
  });
});
