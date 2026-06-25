import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isExplorationDirty,
  markExplorationDirty,
  markExplorationClean,
  subscribeExploration,
} from "./exploration";

beforeEach(() => markExplorationClean());

describe("exploration dirty tracker", () => {
  it("starts clean and toggles dirty/clean", () => {
    expect(isExplorationDirty()).toBe(false);
    markExplorationDirty();
    expect(isExplorationDirty()).toBe(true);
    markExplorationClean();
    expect(isExplorationDirty()).toBe(false);
  });

  it("notifies subscribers only on actual transitions", () => {
    const cb = vi.fn();
    const unsub = subscribeExploration(cb);
    markExplorationDirty();
    markExplorationDirty(); // already dirty → no extra emit
    expect(cb).toHaveBeenCalledTimes(1);
    markExplorationClean();
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    markExplorationDirty();
    expect(cb).toHaveBeenCalledTimes(2); // unsubscribed
  });
});
