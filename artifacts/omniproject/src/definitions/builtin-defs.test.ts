import { describe, it, expect } from "vitest";
import { parseBuiltinArtifacts } from "./builtin-defs";
import { BUILTIN_ARTIFACTS } from "./index";

describe("parseBuiltinArtifacts", () => {
  it("validates, forces builtin:true, dedupes by id and sorts", () => {
    const out = parseBuiltinArtifacts({
      "b.json": { id: "b", kind: "view", label: "B", spec: {} },
      "a.json": { id: "a", kind: "report", label: "A", builtin: false, spec: { scope: "tasks" } },
      "dup.json": { id: "a", kind: "chart", label: "A dup", spec: {} }, // first id wins
    });
    expect(out.map((d) => d.id)).toEqual(["a", "b"]); // sorted
    expect(out.every((d) => d.builtin === true)).toBe(true); // forced read-only
    expect(out.find((d) => d.id === "a")!.label).toBe("A"); // dedupe kept the first
  });

  it("skips malformed entries rather than throwing", () => {
    const out = parseBuiltinArtifacts({
      "ok.json": { id: "ok", kind: "view", label: "OK", spec: {} },
      "no-id.json": { kind: "view", label: "x", spec: {} },
      "bad-kind.json": { id: "x", kind: "nope", label: "x", spec: {} },
      "no-spec.json": { id: "y", kind: "view", label: "y" },
      "not-object.json": 42,
    });
    expect(out.map((d) => d.id)).toEqual(["ok"]);
  });
});

describe("BUILTIN_ARTIFACTS (enumerated from the folder)", () => {
  it("loads the shipped baseline JSON files, all read-only with unique ids", () => {
    expect(BUILTIN_ARTIFACTS.length).toBeGreaterThanOrEqual(2);
    const ids = BUILTIN_ARTIFACTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_ARTIFACTS.every((d) => d.builtin === true)).toBe(true);
    expect(ids).toContain("builtin.tasks-by-status");
  });
});
