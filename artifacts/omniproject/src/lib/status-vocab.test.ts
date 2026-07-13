import { describe, it, expect } from "vitest";
import { isDone, isCancelled, isTerminal, classifyStage, ragBucket } from "./status-vocab";

describe("isDone", () => {
  it("matches delivered/closed vocabularies across backends", () => {
    for (const s of ["done", "Closed", "COMPLETE", "completed", "resolved", "shipped", "deployed", "released", "live", "accepted"]) {
      expect(isDone(s)).toBe(true);
    }
  });
  it("agrees with an exact match on the canonical enum", () => {
    expect(isDone("done")).toBe(true);
    expect(isDone("in_progress")).toBe(false);
    expect(isDone("in_review")).toBe(false);
    expect(isDone("todo")).toBe(false);
    expect(isDone("cancelled")).toBe(false);
  });
  it("is null/undefined-safe", () => {
    expect(isDone(null)).toBe(false);
    expect(isDone(undefined)).toBe(false);
    expect(isDone("")).toBe(false);
  });
});

describe("isCancelled / isTerminal", () => {
  it("recognises dropped work but not delivered work", () => {
    expect(isCancelled("cancelled")).toBe(true);
    expect(isCancelled("won't do")).toBe(true);
    expect(isCancelled("rejected")).toBe(true);
    expect(isCancelled("duplicate")).toBe(true);
    expect(isCancelled("done")).toBe(false);
  });
  it("terminal covers both done and cancelled", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("in_progress")).toBe(false);
    expect(isTerminal("todo")).toBe(false);
  });
});

describe("classifyStage", () => {
  it("orders cancelled over done over wip", () => {
    expect(classifyStage("cancelled")).toBe("cancelled");
    expect(classifyStage("done")).toBe("done");
    expect(classifyStage("in_progress")).toBe("wip");
    expect(classifyStage("in_review")).toBe("wip");
    expect(classifyStage("backlog")).toBe("other");
    expect(classifyStage("")).toBe("other");
  });
});

describe("ragBucket", () => {
  it("buckets health vocabulary", () => {
    expect(ragBucket("green")).toBe("green");
    expect(ragBucket("on_track")).toBe("green");
    expect(ragBucket("healthy")).toBe("green");
    expect(ragBucket("amber")).toBe("amber");
    expect(ragBucket("at_risk")).toBe("amber");
    expect(ragBucket("red")).toBe("red");
    expect(ragBucket("off_track")).toBe("red");
    expect(ragBucket("blocked")).toBe("red");
  });
  it("buckets benefit vocabulary (the old StrategyAlignment twin)", () => {
    expect(ragBucket("realised")).toBe("green");
    expect(ragBucket("achieved")).toBe("green");
    expect(ragBucket("missed")).toBe("red");
    expect(ragBucket("lost")).toBe("red");
  });
  it("returns none for empty/unknown", () => {
    expect(ragBucket(null)).toBe("none");
    expect(ragBucket("")).toBe("none");
    expect(ragBucket("bananas")).toBe("none");
  });
});
