import { describe, it, expect, beforeEach } from "vitest";
import { scoreMatch, searchEntities, useGlobalSearch, type SearchSources } from "./global-search";

describe("scoreMatch", () => {
  it("ranks exact < prefix < word-boundary < substring, and -1 for no match", () => {
    expect(scoreMatch("Alpha", "alpha")).toBe(0);
    expect(scoreMatch("Alpha Project", "alph")).toBe(1);
    expect(scoreMatch("The Alpha Project", "alpha")).toBe(2);
    expect(scoreMatch("Roadmap", "dma")).toBe(3);
    expect(scoreMatch("Roadmap", "zzz")).toBe(-1);
  });
});

const SOURCES: SearchSources = {
  projects: [{ id: "p1", name: "Apollo" }, { id: "p2", name: "Gemini" }],
  programmes: [{ id: "pr1", name: "Apollo Programme" }],
  issues: [
    { id: "i1", title: "Apollo launch checklist", projectId: "p1" },
    { id: "i2", title: "Unrelated", projectId: "p2" },
  ],
};

describe("searchEntities", () => {
  it("returns nothing for an empty/whitespace query", () => {
    expect(searchEntities("", SOURCES)).toEqual([]);
    expect(searchEntities("   ", SOURCES)).toEqual([]);
  });

  it("matches across projects, issues and programmes, projects ranked first on equal score", () => {
    const hits = searchEntities("apollo", SOURCES);
    const ids = hits.map((h) => `${h.type}:${h.id}`);
    expect(ids).toContain("project:p1");
    expect(ids).toContain("programme:pr1");
    expect(ids).toContain("issue:i1");
    expect(ids).not.toContain("issue:i2");
    // "Apollo" (project, prefix) outranks the word-boundary issue match.
    expect(hits[0]).toMatchObject({ type: "project", id: "p1" });
  });

  it("carries projectId on issue hits (for routing + side-panel)", () => {
    const hit = searchEntities("checklist", SOURCES).find((h) => h.type === "issue");
    expect(hit?.projectId).toBe("p1");
  });

  it("respects the result cap", () => {
    const many: SearchSources = { projects: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `Match ${i}` })) };
    expect(searchEntities("match", many, 10)).toHaveLength(10);
  });

  it("tolerates missing source lists", () => {
    expect(searchEntities("apollo", { projects: [{ id: "p1", name: "Apollo" }] })).toHaveLength(1);
  });
});

describe("useGlobalSearch store", () => {
  beforeEach(() => useGlobalSearch.setState({ open: false }));
  it("toggles open", () => {
    useGlobalSearch.getState().setOpen(true);
    expect(useGlobalSearch.getState().open).toBe(true);
  });
});
