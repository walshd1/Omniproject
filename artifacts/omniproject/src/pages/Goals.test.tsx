import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import type { Goal, GoalMeta } from "../lib/goals";

/**
 * The Goals page composes the list surface (useGoals), the create form (useCreateGoal), and the
 * per-goal detail (useGoal + check-in / link / unlink / delete mutations). Each data seam is stubbed
 * behind a mutable module-level knob (the house pattern — see Whiteboards.test.tsx); the pure helpers
 * (goalStatusTone / GOAL_STATUSES / KEY_RESULT_KINDS / formatKeyResultValue) are kept REAL via
 * importOriginal so the shipping presentation logic is what's exercised. The page carries no RBAC or
 * toast seam — errors surface as inline text and DataState blocks — so those are asserted directly.
 */

// --- Per-test knobs (reset in beforeEach), closed over by the vi.mock factory below. ---
let goalsData: GoalMeta[] = [];
let goalsLoading = false;
let goalsError = false;
let goalDetail: Goal | null = null;
let goalLoading = false;
let goalDetailError = false;
let createPending = false;
let createErr = false;
let createMode: "ok" | "err" = "ok";
let checkInPending = false;

const createMutate = vi.fn((_input: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
  if (createMode === "ok") opts?.onSuccess?.({ id: "g-new" });
});
const checkInMutate = vi.fn((_vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
  opts?.onSuccess?.({});
});
const linkMutate = vi.fn((_vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
  opts?.onSuccess?.({});
});
const delMutate = vi.fn();
const unlinkMutate = vi.fn();
const refetch = vi.fn();

vi.mock("../lib/goals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/goals")>();
  return {
    ...actual,
    useGoals: () => ({
      data: goalsData, isLoading: goalsLoading, isError: goalsError,
      error: goalsError ? new Error("list boom") : undefined, refetch,
    }),
    useGoal: (id?: string) => ({
      data: id ? goalDetail : undefined, isLoading: goalLoading, isError: goalDetailError,
      error: goalDetailError ? new Error("detail boom") : undefined, refetch,
    }),
    useCreateGoal: () => ({ mutate: createMutate, isPending: createPending, isError: createErr }),
    useCheckInGoal: () => ({ mutate: checkInMutate, isPending: checkInPending }),
    useDeleteGoal: () => ({ mutate: delMutate }),
    useLinkGoal: () => ({ mutate: linkMutate }),
    useUnlinkGoal: () => ({ mutate: unlinkMutate }),
  };
});

const { Goals } = await import("./Goals");

const meta = (over: Partial<GoalMeta> = {}): GoalMeta => ({
  id: "g1", title: "Grow adoption", status: "on_track", progressPct: 40,
  keyResultCount: 2, checkInCount: 1, lastCheckInAt: null, linkCount: 0, updatedAt: "", ...over,
});

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g1", title: "Grow adoption", status: "on_track", progressPct: 40,
  keyResultCount: 1, checkInCount: 1, lastCheckInAt: null, linkCount: 1, updatedAt: "",
  description: "Increase active users",
  cadence: "every 2 weeks", nextCheckInAt: "2026-08-01",
  keyResults: [{ id: "kr1", label: "Active users", kind: "number", startValue: 0, target: 100, current: 40, unit: "users" }],
  checkins: [{ id: "c1", at: "2026-07-01T00:00:00Z", by: null, note: "Steady", status: "on_track", progressPct: 40, krValues: {} }],
  links: [{ key: "lk1", system: "jira", projectRef: "PLT", itemRef: "123", label: "Fix login", linkedAt: "" }],
  version: 1, createdAt: "", updatedBy: null,
  ...over,
});

/** Render the page and select the (already-seeded) goal so KeyResultCheckIn mounts. */
function openDetail() {
  const view = renderWithProviders(<Goals />);
  fireEvent.click(screen.getByTestId("goal-row-g1"));
  return view;
}

beforeEach(() => {
  goalsData = [];
  goalsLoading = false;
  goalsError = false;
  goalDetail = null;
  goalLoading = false;
  goalDetailError = false;
  createPending = false;
  createErr = false;
  createMode = "ok";
  checkInPending = false;
  createMutate.mockClear();
  checkInMutate.mockClear();
  linkMutate.mockClear();
  delMutate.mockClear();
  unlinkMutate.mockClear();
  refetch.mockClear();
});

describe("Goals list", () => {
  it("renders the page heading and the empty-state prompt", () => {
    renderWithProviders(<Goals />);
    expect(screen.getByRole("heading", { level: 1, name: /goals & okrs/i })).toBeInTheDocument();
    expect(screen.getByText(/No goals yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Select a goal to check in/i)).toBeInTheDocument();
  });

  it("shows the loading placeholder while the list is loading", () => {
    goalsLoading = true;
    renderWithProviders(<Goals />);
    expect(screen.queryByTestId("goal-list")).toBeNull();
    expect(screen.getByText("LOADING…")).toBeInTheDocument();
  });

  it("shows the error block and retries the list query", () => {
    goalsError = true;
    renderWithProviders(<Goals />);
    expect(screen.getByRole("alert")).toHaveTextContent(/list boom/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders a row per goal with progress, KR count and the next check-in", () => {
    goalsData = [
      meta({ id: "g1", nextCheckInAt: "2026-08-01" }),
      meta({ id: "g2", title: "Ship v2", progressPct: 90, status: "at_risk", checkInCount: 3 }),
    ];
    renderWithProviders(<Goals />);
    const row = screen.getByTestId("goal-row-g1");
    expect(row).toHaveTextContent("Grow adoption");
    expect(row).toHaveTextContent("40%");
    expect(row).toHaveTextContent("2 KR");
    expect(row).toHaveTextContent("next 2026-08-01");
    // g2 has no nextCheckInAt → the "next …" suffix is omitted.
    expect(screen.getByTestId("goal-row-g2")).not.toHaveTextContent("next");
  });

  it("selects a goal and mounts its detail panel", () => {
    goalsData = [meta()];
    goalDetail = goal();
    openDetail();
    expect(screen.getByTestId("goal-detail")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Grow adoption" })).toBeInTheDocument();
  });
});

describe("Create goal form", () => {
  it("toggles the create form open and closed", () => {
    renderWithProviders(<Goals />);
    expect(screen.queryByTestId("goal-create-form")).toBeNull();
    fireEvent.click(screen.getByTestId("goal-new"));
    expect(screen.getByTestId("goal-create-form")).toBeInTheDocument();
    // Empty state hidden while creating even with no goals.
    expect(screen.queryByText(/No goals yet/i)).toBeNull();
    fireEvent.click(screen.getByTestId("goal-new"));
    expect(screen.queryByTestId("goal-create-form")).toBeNull();
  });

  it("does not submit with a blank title (guard + disabled button)", () => {
    renderWithProviders(<Goals />);
    fireEvent.click(screen.getByTestId("goal-new"));
    const submit = screen.getByTestId("goal-create-submit");
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("submits a full goal (description, cadence, org storage, unit) and closes on success", () => {
    renderWithProviders(<Goals />);
    fireEvent.click(screen.getByTestId("goal-new"));
    fireEvent.change(screen.getByTestId("goal-title"), { target: { value: "  Grow adoption  " } });
    fireEvent.change(screen.getByPlaceholderText(/Description/i), { target: { value: "Increase users" } });
    fireEvent.change(screen.getByTestId("goal-cadence"), { target: { value: "weekly" } });
    fireEvent.change(screen.getByLabelText("Storage"), { target: { value: "org" } });
    // First KR: filled, with a unit.
    fireEvent.change(screen.getByLabelText("Key result 1 label"), { target: { value: "Active users" } });
    fireEvent.change(screen.getByLabelText("Key result 1 kind"), { target: { value: "percent" } });
    fireEvent.change(screen.getByLabelText("Key result 1 current"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Key result 1 target"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Key result 1 unit"), { target: { value: "pct" } });
    // Add a second, blank KR → filtered out by label.trim().
    fireEvent.click(screen.getByText(/Add key result/i));
    fireEvent.click(screen.getByTestId("goal-create-submit"));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      title: "Grow adoption", storage: "org", description: "Increase users", cadence: "weekly",
    });
    const krs = payload.keyResults as Array<Record<string, unknown>>;
    expect(krs).toHaveLength(1);
    expect(krs[0]).toMatchObject({ label: "Active users", kind: "percent", current: 10, target: 90, unit: "pct" });
    // onSuccess ran → form closed.
    expect(screen.queryByTestId("goal-create-form")).toBeNull();
  });

  it("omits optional fields and coerces non-numeric KR values to 0", () => {
    renderWithProviders(<Goals />);
    fireEvent.click(screen.getByTestId("goal-new"));
    fireEvent.change(screen.getByTestId("goal-title"), { target: { value: "Bare goal" } });
    fireEvent.change(screen.getByLabelText("Key result 1 label"), { target: { value: "KR" } });
    fireEvent.change(screen.getByLabelText("Key result 1 current"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Key result 1 target"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("goal-create-submit"));
    const payload = createMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.description).toBeUndefined();
    expect(payload.cadence).toBeUndefined();
    const krs = payload.keyResults as Array<Record<string, unknown>>;
    expect(krs[0]).toMatchObject({ current: 0, target: 0 });
    expect(krs[0]).not.toHaveProperty("unit");
  });

  it("shows a saving affordance while the create mutation is pending", () => {
    createPending = true;
    renderWithProviders(<Goals />);
    fireEvent.click(screen.getByTestId("goal-new"));
    fireEvent.change(screen.getByTestId("goal-title"), { target: { value: "T" } });
    const submit = screen.getByTestId("goal-create-submit");
    expect(submit).toHaveTextContent("Saving…");
    expect(submit).toBeDisabled();
  });

  it("surfaces the inline error when creation fails", () => {
    createErr = true;
    createMode = "err";
    renderWithProviders(<Goals />);
    fireEvent.click(screen.getByTestId("goal-new"));
    expect(screen.getByText(/Couldn't create the goal/i)).toBeInTheDocument();
    // Cancel closes the form.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByTestId("goal-create-form")).toBeNull();
  });
});

describe("Goal detail — check-in", () => {
  it("shows the loading and error states for the detail panel", () => {
    goalsData = [meta()];
    goalLoading = true;
    const { unmount } = openDetail();
    expect(screen.getByText("LOADING…")).toBeInTheDocument();
    unmount();

    goalLoading = false;
    goalDetailError = true;
    openDetail();
    expect(screen.getByRole("alert")).toHaveTextContent(/detail boom/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the goal header, progress, cadence and history", () => {
    goalsData = [meta()];
    goalDetail = goal();
    openDetail();
    expect(screen.getByText("Increase active users")).toBeInTheDocument();
    expect(screen.getByTestId("goal-progress")).toHaveTextContent("40%");
    expect(screen.getByText(/Cadence:/)).toHaveTextContent("every 2 weeks");
    expect(screen.getByText(/next check-in 2026-08-01/)).toBeInTheDocument();
    expect(screen.getByText(/Active users/)).toBeInTheDocument();
    expect(screen.getByText("/ 100 users")).toBeInTheDocument();
    expect(screen.getByTestId("goal-history")).toHaveTextContent("Steady");
  });

  it("omits description, cadence and history when absent, and shows the no-KR / no-links notes", () => {
    goalsData = [meta()];
    goalDetail = goal({ description: null, cadence: null, nextCheckInAt: null, keyResults: [], links: [], checkins: [] });
    openDetail();
    expect(screen.queryByText(/Cadence:/)).toBeNull();
    expect(screen.queryByTestId("goal-history")).toBeNull();
    expect(screen.getByText(/No key results/i)).toBeInTheDocument();
    expect(screen.getByText(/No linked work yet/i)).toBeInTheDocument();
  });

  it("renders a cadence with no next check-in date", () => {
    goalsData = [meta()];
    goalDetail = goal({ cadence: "monthly", nextCheckInAt: null });
    openDetail();
    expect(screen.getByText(/Cadence:/)).toHaveTextContent("monthly");
    expect(screen.queryByText(/next check-in/)).toBeNull();
  });

  it("deletes the goal", () => {
    goalsData = [meta()];
    goalDetail = goal();
    openDetail();
    fireEvent.click(screen.getByRole("button", { name: /delete goal/i }));
    expect(delMutate).toHaveBeenCalledWith("g1");
  });

  it("submits a check-in with edited values, note and status, then resets the fields", () => {
    goalsData = [meta()];
    goalDetail = goal();
    openDetail();
    const krInput = screen.getByLabelText("Update Active users") as HTMLInputElement;
    // Default value is the KR's current.
    expect(krInput.value).toBe("40");
    fireEvent.change(krInput, { target: { value: "55" } });
    const note = screen.getByTestId("checkin-note") as HTMLInputElement;
    fireEvent.change(note, { target: { value: "good progress" } });
    fireEvent.change(screen.getByLabelText("Set status"), { target: { value: "at_risk" } });
    fireEvent.click(screen.getByTestId("checkin-submit"));

    expect(checkInMutate).toHaveBeenCalledTimes(1);
    const vars = checkInMutate.mock.calls[0]![0] as { id: string; input: Record<string, unknown> };
    expect(vars.id).toBe("g1");
    expect(vars.input).toMatchObject({ note: "good progress", status: "at_risk", krValues: { kr1: 55 } });
    // onSuccess reset the fields.
    expect((screen.getByTestId("checkin-note") as HTMLInputElement).value).toBe("");
    expect(krInput.value).toBe("40");
  });

  it("skips a non-finite KR value and omits an empty note/status from the check-in", () => {
    goalsData = [meta()];
    goalDetail = goal();
    openDetail();
    fireEvent.change(screen.getByLabelText("Update Active users"), { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByTestId("checkin-submit"));
    const vars = checkInMutate.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(vars.input.krValues).toEqual({});
    expect(vars.input).not.toHaveProperty("note");
    expect(vars.input).not.toHaveProperty("status");
  });

  it("disables the check-in button while the mutation is pending", () => {
    goalsData = [meta()];
    goalDetail = goal();
    checkInPending = true;
    openDetail();
    expect(screen.getByTestId("checkin-submit")).toBeDisabled();
  });
});

describe("Goal detail — links", () => {
  it("lists linked work and unlinks an item", () => {
    goalsData = [meta()];
    goalDetail = goal();
    openDetail();
    expect(screen.getByText("Fix login")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unlink 123/i }));
    expect(unlinkMutate).toHaveBeenCalledWith({ id: "g1", key: "lk1" });
  });

  it("falls back to a composed label when a link has none", () => {
    goalsData = [meta()];
    goalDetail = goal({ links: [{ key: "lk2", system: "gh", projectRef: "repo", itemRef: "9", linkedAt: "" }] });
    openDetail();
    expect(screen.getByText("gh:repo/9")).toBeInTheDocument();
  });

  it("links new work when all three refs are present and resets the inputs", () => {
    goalsData = [meta()];
    goalDetail = goal();
    openDetail();
    fireEvent.change(screen.getByLabelText("System"), { target: { value: "jira" } });
    fireEvent.change(screen.getByLabelText("Project ref"), { target: { value: "PLT" } });
    fireEvent.change(screen.getByLabelText("Item ref"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));
    expect(linkMutate).toHaveBeenCalledWith(
      { id: "g1", input: { system: "jira", projectRef: "PLT", itemRef: "42" } },
      expect.anything(),
    );
    expect((screen.getByLabelText("Item ref") as HTMLInputElement).value).toBe("");
  });

  it("guards the link action when a ref is missing", () => {
    goalsData = [meta()];
    goalDetail = goal();
    openDetail();
    fireEvent.change(screen.getByLabelText("System"), { target: { value: "jira" } });
    // projectRef + itemRef left blank.
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));
    expect(linkMutate).not.toHaveBeenCalled();
  });
});
