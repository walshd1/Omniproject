import { describe, it, expect } from "vitest";
import { matchesLive } from "./live-events";

/**
 * matchesLive decides whether a live event should revalidate a panel.
 */
describe("matchesLive", () => {
  it("any change revalidates when no kinds are specified", () => {
    expect(matchesLive({ kind: "deadline" })).toBe(true);
    expect(matchesLive({})).toBe(true);
    expect(matchesLive({ kind: "x" }, [])).toBe(true);
  });

  it("restricts to the listed kinds when liveOn is given", () => {
    expect(matchesLive({ kind: "deadline" }, ["deadline", "assignment"])).toBe(true);
    expect(matchesLive({ kind: "critical" }, ["deadline"])).toBe(false);
    expect(matchesLive({}, ["deadline"])).toBe(false); // no kind ⇒ no match when filtered
  });
});
