import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isExplorationDirty,
  markExplorationDirty,
  markExplorationClean,
  explorationDirtySources,
  subscribeExploration,
} from "./exploration";

beforeEach(() => markExplorationClean()); // no-arg = clear all sources (session reset)

describe("exploration dirty tracker", () => {
  it("starts clean and toggles dirty/clean per source", () => {
    expect(isExplorationDirty()).toBe(false);
    markExplorationDirty("snapshots");
    expect(isExplorationDirty()).toBe(true);
    markExplorationClean("snapshots");
    expect(isExplorationDirty()).toBe(false);
  });

  it("notifies subscribers only on actual transitions", () => {
    const cb = vi.fn();
    const unsub = subscribeExploration(cb);
    markExplorationDirty("snapshots");
    markExplorationDirty("snapshots"); // already dirty → no extra emit
    expect(cb).toHaveBeenCalledTimes(1);
    markExplorationClean("snapshots");
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    markExplorationDirty("snapshots");
    expect(cb).toHaveBeenCalledTimes(2); // unsubscribed
  });

  it("DATA-LOSS REGRESSION: downloading one source does NOT clear another's unsaved warning", () => {
    // The user has unsaved snapshots AND an active replica-workbench overlay.
    markExplorationDirty("snapshots");
    markExplorationDirty("replica");
    expect(explorationDirtySources().sort()).toEqual(["replica", "snapshots"]);

    // They download the snapshots (exportSnapshots clears only "snapshots").
    markExplorationClean("snapshots");

    // The session is STILL dirty — the replica overlay is unsaved, so the leave-warning stays up.
    expect(isExplorationDirty()).toBe(true);
    expect(explorationDirtySources()).toEqual(["replica"]);
  });

  it("no-arg clean clears every source (explicit discard/reset)", () => {
    markExplorationDirty("snapshots");
    markExplorationDirty("edges");
    markExplorationDirty("shifts");
    markExplorationClean();
    expect(isExplorationDirty()).toBe(false);
  });
});
