import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Capabilities, Issue } from "@workspace/api-client-react";
import { useIssueForm, EMPTY_FORM } from "./use-issue-form";

/**
 * Direct hook tests for the issue-dialog form model: the hydrate-on-open effect
 * (from an existing issue vs empty defaults), every optional-field `!= null` / `??`
 * ternary, and the capability-gated `buildPayload` — both the "store it" and
 * "drop it" side of each `editF(...)` guard.
 */

/** An issue with every optional/numeric field populated, to hit the "present" ternary arms. */
function fullIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    projectId: "p1",
    title: "Full issue",
    description: "some detail",
    status: "in_progress",
    priority: "high",
    assignee: "ada",
    labels: ["infra", "auth"],
    source: "jira",
    startDate: "2026-01-01",
    dueDate: "2026-02-01",
    budget: 1000,
    actualCost: 250,
    costCenter: "CC-1",
    currency: "USD",
    billable: true,
    estimateHours: 40,
    loggedHours: 26,
    remainingHours: 14,
    storyPoints: 8,
    healthStatus: "amber",
    riskLevel: "high",
    impact: "high",
    urgency: "medium",
    blocked: true,
    blockedReason: "waiting on infra",
    mitigation: "spike it",
    defectCount: 3,
    version: 2,
    ...over,
  } as Issue;
}

/** Build a Capabilities whose every listed field has the given store flag. */
function capsWithStore(store: boolean): Capabilities {
  const keys = [
    "budget", "actualCost", "billable", "costCenter", "currency",
    "estimateHours", "loggedHours", "remainingHours", "storyPoints",
    "healthStatus", "riskLevel", "impact", "urgency",
    "blocked", "blockedReason", "mitigation", "defectCount",
  ];
  const fields: Record<string, { surface: boolean; store: boolean }> = {};
  for (const k of keys) fields[k] = { surface: true, store };
  return { mode: "n8n", fields } as unknown as Capabilities;
}

describe("useIssueForm hydrate effect", () => {
  it("does not hydrate while the dialog is closed", () => {
    // `issue` MUST be a stable reference across renders: it is a dependency of the hook's
    // hydrate effect, so recreating it inline in the render callback would re-fire the effect
    // (setForm → re-render → new object → …) into an unbounded render loop.
    const issue = fullIssue();
    const { result } = renderHook(() => useIssueForm(issue, undefined, false, undefined));
    // Effect returns early on !open — form keeps its empty initial state.
    expect(result.current.form).toEqual(EMPTY_FORM);
  });

  it("hydrates every field from the issue being edited (present ternary arms)", () => {
    const issue = fullIssue(); // stable ref — see note above
    const { result } = renderHook(() => useIssueForm(issue, undefined, true, undefined));
    const f = result.current.form;
    expect(f.title).toBe("Full issue");
    expect(f.description).toBe("some detail");
    expect(f.labels).toBe("infra, auth");
    expect(f.budget).toBe("1000");
    expect(f.actualCost).toBe("250");
    expect(f.remainingHours).toBe("14");
    expect(f.storyPoints).toBe("8");
    expect(f.defectCount).toBe("3");
    expect(f.billable).toBe(true);
    expect(f.blocked).toBe(true);
    expect(f.costCenter).toBe("CC-1");
  });

  it("maps missing optional fields to empty strings (absent ternary arms)", () => {
    const bare = {
      id: "i2", projectId: "p1", title: "Bare", status: "todo", priority: "none",
      labels: [], source: "jira", version: 1,
    } as unknown as Issue;
    const { result } = renderHook(() => useIssueForm(bare, undefined, true, undefined));
    const f = result.current.form;
    expect(f.description).toBe("");
    expect(f.assignee).toBe("");
    expect(f.budget).toBe("");
    expect(f.actualCost).toBe("");
    expect(f.remainingHours).toBe("");
    expect(f.storyPoints).toBe("");
    expect(f.defectCount).toBe("");
    expect(f.healthStatus).toBe("");
    expect(f.billable).toBe(false);
    expect(f.blocked).toBe(false);
  });

  it("seeds the empty form with the provided default status when creating", () => {
    const { result } = renderHook(() => useIssueForm(null, "in_review", true, undefined));
    expect(result.current.form).toEqual({ ...EMPTY_FORM, status: "in_review" });
  });

  it("falls back to 'backlog' when creating with no default status", () => {
    const { result } = renderHook(() => useIssueForm(null, undefined, true, undefined));
    expect(result.current.form.status).toBe("backlog");
  });

  it("re-hydrates and clears the title error when re-opened for a different issue", () => {
    const { result, rerender } = renderHook(
      ({ issue, open }: { issue: Issue | null; open: boolean }) => useIssueForm(issue, undefined, open, undefined),
      { initialProps: { issue: fullIssue() as Issue | null, open: true } },
    );
    act(() => result.current.setTitleError("boom"));
    expect(result.current.titleError).toBe("boom");
    // Close then re-open with a new issue: the effect re-runs and resets the error.
    rerender({ issue: fullIssue({ id: "other", title: "Other" }), open: false });
    rerender({ issue: fullIssue({ id: "other", title: "Other" }), open: true });
    expect(result.current.titleError).toBeNull();
    expect(result.current.form.title).toBe("Other");
  });
});

describe("useIssueForm buildPayload", () => {
  it("includes every capability-gated field when the backend can store them (fallback caps=undefined)", () => {
    // caps=undefined → editF falls back to true, so every optional field is sent.
    const issue = fullIssue(); // stable ref — see note above
    const { result } = renderHook(() => useIssueForm(issue, undefined, true, undefined));
    const payload = result.current.buildPayload() as Record<string, unknown>;
    expect(payload.title).toBe("Full issue");
    expect(payload.description).toBe("some detail");
    expect(payload.assignee).toBe("ada");
    expect(payload.labels).toEqual(["infra", "auth"]);
    expect(payload.startDate).toBe("2026-01-01");
    expect(payload.dueDate).toBe("2026-02-01");
    expect(payload.budget).toBe(1000);
    expect(payload.actualCost).toBe(250);
    expect(payload.billable).toBe(true);
    expect(payload.costCenter).toBe("CC-1");
    expect(payload.currency).toBe("USD");
    expect(payload.estimateHours).toBe(40);
    expect(payload.loggedHours).toBe(26);
    expect(payload.remainingHours).toBe(14);
    expect(payload.storyPoints).toBe(8);
    expect(payload.healthStatus).toBe("amber");
    expect(payload.riskLevel).toBe("high");
    expect(payload.impact).toBe("high");
    expect(payload.urgency).toBe("medium");
    expect(payload.blocked).toBe(true);
    expect(payload.blockedReason).toBe("waiting on infra");
    expect(payload.mitigation).toBe("spike it");
    expect(payload.defectCount).toBe(3);
  });

  it("also includes them when caps explicitly allow storing", () => {
    const issue = fullIssue(); // stable ref — see note above
    const caps = capsWithStore(true);
    const { result } = renderHook(() => useIssueForm(issue, undefined, true, caps));
    const payload = result.current.buildPayload() as Record<string, unknown>;
    expect(payload).toHaveProperty("budget");
    expect(payload).toHaveProperty("mitigation");
    expect(payload).toHaveProperty("defectCount");
  });

  it("omits every capability-gated field when the backend cannot store them", () => {
    const issue = fullIssue(); // stable ref — see note above
    const caps = capsWithStore(false);
    const { result } = renderHook(() => useIssueForm(issue, undefined, true, caps));
    const payload = result.current.buildPayload() as Record<string, unknown>;
    // Core fields still present…
    expect(payload.title).toBe("Full issue");
    expect(payload.status).toBe("in_progress");
    expect(payload.labels).toEqual(["infra", "auth"]);
    // …but the gated ones are dropped entirely.
    for (const k of [
      "budget", "actualCost", "billable", "costCenter", "currency",
      "estimateHours", "loggedHours", "remainingHours", "storyPoints",
      "healthStatus", "riskLevel", "impact", "urgency",
      "blocked", "blockedReason", "mitigation", "defectCount",
    ]) {
      expect(payload).not.toHaveProperty(k);
    }
  });

  it("drops an empty description and nulls empty assignee/dates/text fields", () => {
    const { result } = renderHook(() => useIssueForm(null, "backlog", true, undefined));
    // Empty form (no description, blank assignee/dates), everything storable via fallback.
    const payload = result.current.buildPayload() as Record<string, unknown>;
    expect(payload).not.toHaveProperty("description"); // empty → omitted
    expect(payload.assignee).toBeNull();
    expect(payload.startDate).toBeNull();
    expect(payload.dueDate).toBeNull();
    expect(payload.labels).toEqual([]);
    expect(payload.costCenter).toBeNull();
    expect(payload.currency).toBeNull();
    expect(payload.healthStatus).toBeNull();
    expect(payload.budget).toBeNull(); // parseNumberOrNull("")
  });

  it("trims whitespace off title/description and filters blank labels", () => {
    const { result } = renderHook(() => useIssueForm(null, "backlog", true, undefined));
    act(() =>
      result.current.setForm((p) => ({
        ...p,
        title: "  Padded  ",
        description: "  detail  ",
        labels: "a, , b ,",
        assignee: "  bob  ",
      })),
    );
    const payload = result.current.buildPayload() as Record<string, unknown>;
    expect(payload.title).toBe("Padded");
    expect(payload.description).toBe("detail");
    expect(payload.labels).toEqual(["a", "b"]);
    expect(payload.assignee).toBe("bob");
  });
});

describe("useIssueForm showF/editF gating helpers", () => {
  it("reflects surface/store capabilities", () => {
    const caps = {
      mode: "n8n",
      fields: { description: { surface: false, store: false }, assignee: { surface: true, store: false } },
    } as unknown as Capabilities;
    const { result } = renderHook(() => useIssueForm(null, "backlog", true, caps));
    expect(result.current.showF("description")).toBe(false);
    expect(result.current.showF("assignee")).toBe(true);
    expect(result.current.editF("assignee")).toBe(false);
    // Unknown field falls back to permissive true.
    expect(result.current.showF("title")).toBe(true);
    expect(result.current.editF("title")).toBe(true);
  });
});
