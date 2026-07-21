import { describe, it, expect } from "vitest";
import { defaultTagColor, resolveTagColor, tagPath, tagChildren, cleanTagPrefs, type TagPrefs } from "./tag-prefs";

/**
 * tag-prefs — the pure per-user tag colour + hierarchy overlay. Covers deterministic default colours,
 * colour resolution (chosen vs derived), the ancestor-path walk (with cycle/depth guards), children
 * lookup, and the untrusted-input sanitiser.
 */
describe("defaultTagColor", () => {
  it("is deterministic and case/space-insensitive", () => {
    expect(defaultTagColor("work")).toBe(defaultTagColor("  WORK "));
  });
  it("returns an hsl() string", () => {
    expect(defaultTagColor("x")).toMatch(/^hsl\(\d+ 55% 45%\)$/);
  });
});

describe("resolveTagColor", () => {
  it("uses a valid chosen hex colour", () => {
    expect(resolveTagColor("work", { work: { color: "#ff0000" } })).toBe("#ff0000");
  });
  it("falls back to the default for an unset or invalid colour", () => {
    expect(resolveTagColor("work", {})).toBe(defaultTagColor("work"));
    expect(resolveTagColor("work", { work: { color: "not-a-hex" } })).toBe(defaultTagColor("work"));
  });
});

describe("tagPath", () => {
  const prefs: TagPrefs = { child: { parent: "mid" }, mid: { parent: "root" } };
  it("walks the ancestor chain ending in the tag", () => {
    expect(tagPath("child", prefs)).toEqual(["root", "mid", "child"]);
  });
  it("is just the tag itself when top-level", () => {
    expect(tagPath("root", prefs)).toEqual(["root"]);
  });
  it("stops safely on a cycle", () => {
    const cyclic: TagPrefs = { a: { parent: "b" }, b: { parent: "a" } };
    const path = tagPath("a", cyclic);
    expect(path[path.length - 1]).toBe("a");
    // No infinite loop, and no duplicate of a already-seen ancestor.
    expect(new Set(path).size).toBe(path.length);
  });
});

describe("tagChildren", () => {
  it("returns direct children sorted", () => {
    const prefs: TagPrefs = { z: { parent: "root" }, a: { parent: "root" }, other: { parent: "x" } };
    expect(tagChildren("root", prefs)).toEqual(["a", "z"]);
  });
});

describe("cleanTagPrefs", () => {
  it("keeps valid colours and parents, drops empties", () => {
    const out = cleanTagPrefs({ work: { color: "#abc", parent: "life" }, empty: {}, bad: { color: "xyz" } });
    expect(out).toEqual({ work: { color: "#abc", parent: "life" } });
  });
  it("drops a self-parent and forbidden keys", () => {
    const out = cleanTagPrefs({ loop: { parent: "loop" }, __proto__: { color: "#fff" } });
    expect(out).toEqual({});
  });
  it("returns {} for non-object input", () => {
    expect(cleanTagPrefs(null)).toEqual({});
    expect(cleanTagPrefs([1, 2])).toEqual({});
  });
});
