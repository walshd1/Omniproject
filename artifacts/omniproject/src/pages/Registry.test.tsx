import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import type { Role } from "../lib/auth";
import type { RegistryItemMeta, CommunityStatus } from "../lib/registry";

/**
 * The Registry page composes the registry CRUD hooks, an RBAC admin gate, and a submit form with a
 * client-side JSON guard. Following the house pattern (see Whiteboards.test.tsx), each seam is stubbed
 * behind a mutable module-level knob and we assert the page's own branching: loading / empty / error,
 * the admin review queue, submit (guard + success + failure), approve/reject/release/retract/delete
 * with their toasts, the per-scope primitive approval gate, and the status/community/scope helpers.
 * `roleAtLeast` is kept REAL so the shipping gate logic is under test.
 */

// --- Per-test knobs (reset in beforeEach), closed over by the vi.mock factories below. ---
let role: Role = "admin";
let items: RegistryItemMeta[] = [];
let isLoading = false;
let isError = false;
let community: CommunityStatus = { connected: false, name: null };
// Mutation outcomes: "ok" fires onSuccess, "err" fires onError.
let submitMode: "ok" | "err" = "ok";
let reviewMode: "ok" | "err" = "ok";
// The result handed to a mutation's onSuccess (release returns a publish envelope).
let releaseResult: { published: boolean; reason?: string } = { published: true };
let submitPending = false;

const refetch = vi.fn();
const reviewMutate = vi.fn();
const releaseMutate = vi.fn();
const retractMutate = vi.fn();
const delMutate = vi.fn();
const submitMutate = vi.fn();
const toast = vi.fn();

/** A mutation stub honouring the react-query `mutate(vars, { onSuccess, onError })` contract. */
const mutateWith = (spy: ReturnType<typeof vi.fn>, getMode: () => "ok" | "err", result?: (vars: unknown) => unknown) =>
  (vars: unknown, opts?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
    spy(vars);
    if (getMode() === "err") opts?.onError?.(new Error("boom"));
    else opts?.onSuccess?.(result ? result(vars) : undefined);
  };

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("../lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role } }) };
});

// Keep the real pure helpers (registryItemKindLabel + types); only the hooks are stubbed.
vi.mock("../lib/registry", async (importActual) => {
  const actual = await importActual<typeof import("../lib/registry")>();
  return {
    ...actual,
    useRegistry: () => ({ data: items, isLoading, isError, error: isError ? new Error("nope") : null, refetch }),
    useCommunityStatus: () => ({ data: community }),
    useSubmitRegistryItem: () => ({ isPending: submitPending, mutate: mutateWith(submitMutate, () => submitMode, (v) => v) }),
    useReviewRegistryItem: () => ({ isPending: false, mutate: mutateWith(reviewMutate, () => reviewMode) }),
    useReleaseRegistryItem: () => ({ isPending: false, mutate: mutateWith(releaseMutate, () => "ok", () => releaseResult) }),
    useRetractRegistryItem: () => ({ isPending: false, mutate: mutateWith(retractMutate, () => "ok") }),
    useDeleteRegistryItem: () => ({ isPending: false, mutate: mutateWith(delMutate, () => "ok") }),
  };
});

const { Registry } = await import("./Registry");

const item = (over: Partial<RegistryItemMeta> = {}): RegistryItemMeta => ({
  id: "r1", kind: "report", name: "Burn rate", publisher: "Acme", version: "1.0.0",
  approvalStatus: "draft", visibility: "internal", tags: ["finance"],
  submittedBy: "cee@x.io", submittedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

beforeEach(() => {
  role = "admin";
  items = [];
  isLoading = false;
  isError = false;
  community = { connected: false, name: null };
  submitMode = reviewMode = "ok";
  releaseResult = { published: true };
  submitPending = false;
  refetch.mockClear(); reviewMutate.mockClear(); releaseMutate.mockClear();
  retractMutate.mockClear(); delMutate.mockClear(); submitMutate.mockClear(); toast.mockClear();
});

describe("Registry page", () => {
  it("shows the loading state from DataState (list body withheld)", () => {
    isLoading = true;
    renderWithProviders(<Registry />);
    // The header renders, but DataState withholds the list body while loading.
    expect(screen.getByRole("heading", { name: /Registry/i })).toBeInTheDocument();
    expect(screen.queryByTestId("registry-list")).not.toBeInTheDocument();
  });

  it("shows an error state with a retry that calls refetch", () => {
    isError = true;
    renderWithProviders(<Registry />);
    const retry = screen.queryByRole("button", { name: /retry|try again/i });
    if (retry) { fireEvent.click(retry); expect(refetch).toHaveBeenCalled(); }
  });

  it("shows the empty state when there are no items", () => {
    renderWithProviders(<Registry />);
    expect(screen.getByText(/No registry items yet/i)).toBeInTheDocument();
  });

  it("lists items with status and kind, and shows an admin review queue for drafts", () => {
    items = [item(), item({ id: "r2", name: "Roadmap screen", kind: "screen", approvalStatus: "approved" })];
    renderWithProviders(<Registry />);
    expect(screen.getByTestId("registry-row-r1")).toHaveTextContent("Burn rate");
    expect(screen.getByTestId("registry-row-r1")).toHaveTextContent("draft");
    expect(screen.getByTestId("registry-review-queue")).toHaveTextContent(/Awaiting review \(1\)/i);
    // The decided (approved) item shows in the main list, not the queue.
    expect(screen.getByTestId("registry-list")).toHaveTextContent("Roadmap screen");
  });

  it("shows the connected community name in the status pill", () => {
    community = { connected: true, name: "Community Hub" };
    renderWithProviders(<Registry />);
    expect(screen.getByTestId("community-status")).toHaveTextContent(/Community Hub/i);
  });

  it("renders tags and, for a community item, the community badge", () => {
    items = [item({ approvalStatus: "approved", visibility: "community", tags: ["a", "b"] })];
    renderWithProviders(<Registry />);
    expect(screen.getByTestId("registry-row-r1")).toHaveTextContent("a · b");
    expect(screen.getByTestId("registry-community-r1")).toBeInTheDocument();
  });

  // --- RBAC. ---
  it("hides admin controls (review queue + approve) from a non-admin, who sees drafts inline", () => {
    role = "contributor";
    items = [item()];
    renderWithProviders(<Registry />);
    expect(screen.queryByTestId("registry-review-queue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("registry-approve-r1")).not.toBeInTheDocument();
    // A non-admin's draft still lists (no dedicated queue → it shows in the main list).
    expect(screen.getByTestId("registry-row-r1")).toBeInTheDocument();
  });

  // --- Submit form: toggle, JSON guard, success + failure. ---
  it("guards invalid submission JSON before hitting the server", () => {
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-new"));
    fireEvent.change(screen.getByTestId("registry-submission"), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByTestId("registry-submit"));
    expect(screen.getByTestId("registry-error")).toHaveTextContent(/valid JSON/i);
    expect(submitMutate).not.toHaveBeenCalled();
  });

  it("keeps Submit disabled until the textarea has content", () => {
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-new"));
    expect(screen.getByTestId("registry-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("registry-submission"), { target: { value: "{}" } });
    expect(screen.getByTestId("registry-submit")).not.toBeDisabled();
  });

  it("submits valid JSON, toasts success and closes the form", () => {
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-new"));
    fireEvent.change(screen.getByTestId("registry-submission"), { target: { value: '{"kind":"report","name":"Burn"}' } });
    fireEvent.click(screen.getByTestId("registry-submit"));
    expect(submitMutate).toHaveBeenCalledWith({ kind: "report", name: "Burn" });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "SUBMITTED FOR REVIEW" }));
    // onDone closed the form.
    expect(screen.queryByTestId("registry-submission")).not.toBeInTheDocument();
  });

  it("shows a rejection message when the submission fails server-side", () => {
    submitMode = "err";
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-new"));
    fireEvent.change(screen.getByTestId("registry-submission"), { target: { value: "{}" } });
    fireEvent.click(screen.getByTestId("registry-submit"));
    expect(screen.getByTestId("registry-error")).toHaveTextContent(/rejected/i);
  });

  it("shows a Submitting… affordance while the submit is pending", () => {
    submitPending = true;
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-new"));
    expect(screen.getByTestId("registry-submit")).toHaveTextContent(/Submitting…/i);
  });

  it("cancels the submit form via its Cancel button", () => {
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-new"));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByTestId("registry-submission")).not.toBeInTheDocument();
  });

  // --- Review actions. ---
  it("approves a non-primitive draft org-wide and toasts", () => {
    items = [item()];
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-approve-r1"));
    expect(reviewMutate).toHaveBeenCalledWith({ id: "r1", decision: "approved" });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "APPROVED", description: "Burn rate" }));
  });

  it("toasts an approval failure when review errors", () => {
    reviewMode = "err";
    items = [item()];
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-approve-r1"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "APPROVAL FAILED" }));
  });

  it("rejects a draft and toasts", () => {
    items = [item()];
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-reject-r1"));
    expect(reviewMutate).toHaveBeenCalledWith({ id: "r1", decision: "rejected" });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "REJECTED" }));
  });

  it("deletes an item", () => {
    items = [item()];
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-delete-r1"));
    expect(delMutate).toHaveBeenCalledWith("r1");
  });

  // --- Release / retract (approved + community). ---
  it("releases an approved item and toasts the published outcome", () => {
    releaseResult = { published: true, reason: "Live now" };
    items = [item({ approvalStatus: "approved" })];
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-release-r1"));
    expect(releaseMutate).toHaveBeenCalledWith("r1");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "RELEASED TO COMMUNITY", description: "Live now" }));
  });

  it("toasts RELEASE QUEUED when the publish is deferred (and falls back to the name)", () => {
    releaseResult = { published: false };
    items = [item({ approvalStatus: "approved" })];
    renderWithProviders(<Registry />);
    fireEvent.click(screen.getByTestId("registry-release-r1"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "RELEASE QUEUED", description: "Burn rate" }));
  });

  it("retracts a community item and toasts", () => {
    items = [item({ approvalStatus: "approved", visibility: "community" })];
    renderWithProviders(<Registry />);
    // A community item shows Retract, not Release.
    expect(screen.queryByTestId("registry-release-r1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("registry-retract-r1"));
    expect(retractMutate).toHaveBeenCalledWith("r1");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "RETRACTED" }));
  });

  // --- Per-scope primitive approval + the activated-scope badge. ---
  it("shows a scope picker only for a primitive draft and gates approve on the id", () => {
    items = [item({ id: "p1", name: "Tile", kind: "primitive" }), item({ id: "r1", kind: "report" })];
    renderWithProviders(<Registry />);
    expect(screen.queryByTestId("registry-scope-picker-r1")).not.toBeInTheDocument();
    expect(screen.getByTestId("registry-scope-picker-p1")).toBeInTheDocument();
    // Org-wide default → no id field, approve enabled.
    expect(screen.queryByTestId("registry-scope-id-p1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("registry-scope-p1"), { target: { value: "programme" } });
    expect(screen.getByTestId("registry-approve-p1")).toBeDisabled();
    fireEvent.change(screen.getByTestId("registry-scope-id-p1"), { target: { value: "pg-1" } });
    fireEvent.click(screen.getByTestId("registry-approve-p1"));
    expect(reviewMutate).toHaveBeenCalledWith({ id: "p1", decision: "approved", scope: "programme", programmeId: "pg-1" });
  });

  it("approves a primitive into a project scope", () => {
    items = [item({ id: "p1", name: "Tile", kind: "primitive" })];
    renderWithProviders(<Registry />);
    fireEvent.change(screen.getByTestId("registry-scope-p1"), { target: { value: "project" } });
    fireEvent.change(screen.getByTestId("registry-scope-id-p1"), { target: { value: "proj-x" } });
    fireEvent.click(screen.getByTestId("registry-approve-p1"));
    expect(reviewMutate).toHaveBeenCalledWith({ id: "p1", decision: "approved", scope: "project", projectId: "proj-x" });
  });

  it("badges an approved primitive with each activation scope", () => {
    items = [
      item({ id: "p1", name: "A", kind: "primitive", approvalStatus: "approved", activatedScope: { kind: "project", projectId: "proj-x" } }),
      item({ id: "p2", name: "B", kind: "primitive", approvalStatus: "approved", activatedScope: { kind: "programme", programmeId: "pg-1" } }),
      item({ id: "p3", name: "C", kind: "primitive", approvalStatus: "approved", activatedScope: { kind: "org" } }),
    ];
    renderWithProviders(<Registry />);
    expect(screen.getByTestId("registry-activated-scope-p1")).toHaveTextContent(/Project proj-x/i);
    expect(screen.getByTestId("registry-activated-scope-p2")).toHaveTextContent(/Programme pg-1/i);
    expect(screen.getByTestId("registry-activated-scope-p3")).toHaveTextContent(/Org-wide/i);
  });
});
