import { describe, it, expect } from "vitest";
import { resourceLoad, loadDeltas, type LoadInput } from "./resource-load";

const t = (id: string, assignee: string | null, startDay: number, endDay: number, active = true): LoadInput => ({
  id, title: id.toUpperCase(), assignee, startDay, endDay, active,
});

describe("resourceLoad", () => {
  it("reports no contention when a person's tasks don't overlap", () => {
    const load = resourceLoad([t("a", "ada", 0, 4), t("b", "ada", 5, 9)]);
    expect(load).toHaveLength(1);
    expect(load[0].peakConcurrency).toBe(1);
    expect(load[0].contended).toBe(false);
    expect(load[0].peak).toBeNull();
  });

  it("flags overlapping tasks for the same person as contention", () => {
    const load = resourceLoad([t("a", "ada", 0, 6), t("b", "ada", 4, 10)]);
    expect(load[0].peakConcurrency).toBe(2);
    expect(load[0].contended).toBe(true);
    expect(load[0].peak?.tasks.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("ignores done/cancelled tasks and unassigned work", () => {
    const load = resourceLoad([
      t("a", "ada", 0, 6),
      t("b", "ada", 4, 10, false), // not active
      t("c", null, 4, 10), // unassigned
    ]);
    expect(load[0].peakConcurrency).toBe(1);
  });

  it("separates load per person", () => {
    const load = resourceLoad([t("a", "ada", 0, 6), t("b", "ada", 4, 10), t("c", "grace", 0, 3)]);
    const ada = load.find((p) => p.assignee === "ada")!;
    const grace = load.find((p) => p.assignee === "grace")!;
    expect(ada.contended).toBe(true);
    expect(grace.contended).toBe(false);
  });
});

describe("loadDeltas", () => {
  it("flags a person the scenario newly piled up", () => {
    // Base: Ada's two tasks are sequential (no clash). Scenario: the second
    // moved earlier to overlap the first.
    const base = [t("a", "ada", 0, 4), t("b", "ada", 5, 9)];
    const scenario = [t("a", "ada", 0, 4), t("b", "ada", 2, 6)];
    const deltas = loadDeltas(base, scenario);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].assignee).toBe("ada");
    expect(deltas[0].basePeak).toBe(1);
    expect(deltas[0].peakConcurrency).toBe(2);
    expect(deltas[0].newlyContended).toBe(true);
  });

  it("does not flag pre-existing contention as new", () => {
    const both = [t("a", "ada", 0, 6), t("b", "ada", 4, 10)];
    const deltas = loadDeltas(both, both);
    expect(deltas[0].contended).toBe(true);
    expect(deltas[0].newlyContended).toBe(false);
  });
});
