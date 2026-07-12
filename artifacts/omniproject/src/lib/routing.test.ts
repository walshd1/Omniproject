import { describe, it, expect } from "vitest";
import { identityRouting, routingCollisions, routeSourceKey, type FieldRoute } from "./routing";

describe("identityRouting (1:1:1 seed)", () => {
  it("maps each field to a same-named source through one vendor + broker", () => {
    const seed = identityRouting(["budget", "status"], "sql", "sidecar");
    expect(seed).toEqual([
      { uiElement: "budget", vendor: "sql", broker: "sidecar", sourceField: "budget" },
      { uiElement: "status", vendor: "sql", broker: "sidecar", sourceField: "status" },
    ]);
  });

  it("preserves existing routes and only seeds unmapped fields", () => {
    const existing: FieldRoute[] = [{ uiElement: "budget", vendor: "jira", broker: "n8n", sourceField: "cost" }];
    const seed = identityRouting(["budget", "status"], "sql", "sidecar", existing);
    expect(seed).toHaveLength(2);
    expect(seed[0]).toEqual(existing[0]); // untouched
    expect(seed[1]).toEqual({ uiElement: "status", vendor: "sql", broker: "sidecar", sourceField: "status" });
  });

  it("produces a collision-free map (unique targets AND unique sources)", () => {
    const seed = identityRouting(["a", "b", "c"], "v", "b");
    expect(routingCollisions(seed).size).toBe(0);
    expect(new Set(seed.map(routeSourceKey)).size).toBe(seed.length);
  });

  it("ignores blanks and dedupes against existing by uiElement", () => {
    const existing: FieldRoute[] = [{ uiElement: "budget", vendor: "v", broker: "b", sourceField: "budget" }];
    const seed = identityRouting([" budget ", "", "status"], "v", "b", existing);
    expect(seed).toHaveLength(2); // budget already mapped (trimmed match), blank skipped, status added
    expect(seed[1]!.uiElement).toBe("status");
  });
});
