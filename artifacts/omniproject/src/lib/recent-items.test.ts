import { describe, it, expect, beforeEach } from "vitest";
import { addRecent, loadRecents, useRecentItems, RECENTS_CAP, type RecentItem } from "./recent-items";

/**
 * Recently-visited items — a per-browser findability aid; localStorage only, nothing at rest.
 */

const item = (over: Partial<RecentItem> = {}): RecentItem => ({ type: "project", id: "p1", label: "Apollo", ...over });

beforeEach(() => {
  localStorage.clear();
  useRecentItems.setState({ items: [] });
});

describe("addRecent (pure)", () => {
  it("prepends the newest visit", () => {
    const out = addRecent([item({ id: "a" })], item({ id: "b" }));
    expect(out.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("de-duplicates by type+id, moving a re-visit to the front with its latest label", () => {
    const out = addRecent([item({ id: "a", label: "Old" }), item({ id: "b" })], item({ id: "a", label: "New" }));
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
    expect(out[0]!.label).toBe("New");
  });

  it("treats the same id under a different type as distinct", () => {
    const out = addRecent([item({ type: "project", id: "x" })], item({ type: "issue", id: "x" }));
    expect(out).toHaveLength(2);
  });

  it("caps the list at the configured size, dropping the oldest", () => {
    let list: RecentItem[] = [];
    for (let n = 0; n < RECENTS_CAP + 5; n++) list = addRecent(list, item({ id: `i${n}` }));
    expect(list).toHaveLength(RECENTS_CAP);
    expect(list[0]!.id).toBe(`i${RECENTS_CAP + 4}`); // newest first
  });
});

describe("loadRecents", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadRecents()).toEqual([]);
  });

  it("tolerates corrupt JSON and non-array payloads (→ empty, no impact)", () => {
    localStorage.setItem("omni:recents", "{ not json");
    expect(loadRecents()).toEqual([]);
    localStorage.setItem("omni:recents", JSON.stringify({ nope: true }));
    expect(loadRecents()).toEqual([]);
  });

  it("filters out malformed entries", () => {
    localStorage.setItem("omni:recents", JSON.stringify([item(), { id: "x" }, null, { type: "issue", id: "y", label: "Y" }]));
    expect(loadRecents().map((i) => i.id)).toEqual(["p1", "y"]);
  });
});

describe("useRecentItems store", () => {
  it("records a visit and persists it to localStorage", () => {
    useRecentItems.getState().record(item({ id: "z", label: "Zephyr" }));
    expect(useRecentItems.getState().items[0]).toMatchObject({ id: "z", label: "Zephyr" });
    expect(loadRecents()[0]).toMatchObject({ id: "z" });
  });

  it("clears all recents", () => {
    useRecentItems.getState().record(item());
    useRecentItems.getState().clear();
    expect(useRecentItems.getState().items).toEqual([]);
    expect(loadRecents()).toEqual([]);
  });
});
