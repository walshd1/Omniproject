import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import type { Role } from "../../lib/auth";

/**
 * The Proofs page composes the proof CRUD/decision hooks, an RBAC ladder (read viewer+, author
 * contributor+, org proofs manager+), the annotation overlay seam, and a threaded-review panel gated on
 * the `comments` feature. Following the house pattern (see Whiteboards.test.tsx) each seam is stubbed
 * behind a mutable knob; the pure helpers `proofRoomId` + `isProofDecisionHeld` are kept REAL via
 * importOriginal, as is `roleAtLeast`. We assert: the unsupported (501) notice, empty/list rendering
 * with per-decision styling, the create form (RBAC + storage gate + guards + outcomes), save/delete
 * (guards + outcomes + the org-delete manager gate), the decision bar (applied vs held-for-sign-off vs
 * error), and the annotation-overlay → review-thread wiring (general vs per-annotation).
 */
type Ann = { id: string; type: string; x: number; y: number; text?: string };
type OpenProof = {
  id: string; name: string; version: number; decision: string; updatedAt: string;
  deliverable: { kind: string; url: string }; annotations: Ann[];
  storage?: string; decisionVersion?: number; decidedBy?: string | null;
};

let role: Role = "contributor";
let proofsData: unknown = [];
let proofsError = false;
let openProof: OpenProof | null = null;
let commentsOn = false;
let createPending = false;
let savePending = false;
let delPending = false;
let decidePending = false;
// Mutation outcomes.
let createMode: "ok" | "err" = "ok";
let saveMode: "ok" | "err" = "ok";
let delMode: "ok" | "err" = "ok";
let decideMode: "ok" | "err" = "ok";
// The value onDecide receives on success — an applied proof, or a held (sign-off pending) envelope.
let decideResult: unknown = null;
let errValue: unknown = new Error("boom");

const toast = vi.fn();
const createMutate = vi.fn();
const saveMutate = vi.fn();
const delMutate = vi.fn();
const decideMutate = vi.fn();

const mutateWith = (spy: (vars: unknown) => void, getMode: () => "ok" | "err", result?: (vars: unknown) => unknown) =>
  (vars: unknown, opts?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
    spy(vars);
    if (getMode() === "err") opts?.onError?.(errValue);
    else opts?.onSuccess?.(result ? result(vars) : undefined);
  };

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

vi.mock("../../lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role } }) };
});

vi.mock("../../lib/features", () => ({
  useFeatures: () => ({ data: [] }),
  featureEnabled: () => commentsOn,
}));

// Keep the real pure helpers (proofRoomId, isProofDecisionHeld); only the hooks are stubbed.
vi.mock("./proofs", async (importActual) => {
  const actual = await importActual<typeof import("./proofs")>();
  return {
    ...actual,
    useProofs: () => ({ data: proofsData, isError: proofsError }),
    useProof: (id?: string) => ({ data: id ? openProof : undefined }),
    useCreateProof: () => ({ isPending: createPending, mutate: mutateWith(createMutate, () => createMode, (v) => ({ id: "new~p", name: (v as { name: string }).name })) }),
    useSaveProof: () => ({ isPending: savePending, mutate: mutateWith(saveMutate, () => saveMode) }),
    useDeleteProof: () => ({ isPending: delPending, mutate: mutateWith(delMutate, () => delMode) }),
    useDecideProof: () => ({ isPending: decidePending, mutate: mutateWith(decideMutate, () => decideMode, () => decideResult) }),
  };
});

// Overlay stub: buttons drive onChange (dirty), onSelect (open a per-annotation thread) and deselect.
vi.mock("./AnnotationOverlay", () => ({
  AnnotationOverlay: (props: { readOnly?: boolean; onChange: (n: Ann[]) => void; onSelect?: (id: string | null) => void }) => (
    <div data-testid="annotation-overlay" data-readonly={String(props.readOnly)}>
      <button type="button" data-testid="stub-ann-change" onClick={() => props.onChange([{ id: "a1", type: "pin", x: 0.1, y: 0.1 }])}>change</button>
      <button type="button" data-testid="stub-ann-select" onClick={() => props.onSelect?.("a1")}>select</button>
      <button type="button" data-testid="stub-ann-deselect" onClick={() => props.onSelect?.(null)}>deselect</button>
    </div>
  ),
}));

vi.mock("../../components/issue-dialog/CommentsPanel", () => ({
  CommentsPanel: ({ roomId }: { roomId: string }) => <div data-testid="comments-panel" data-room={roomId} />,
}));

const { Proofs } = await import("./Proofs");

const listItem = (over: Partial<{ id: string; name: string; decision: string }> = {}) => ({
  id: "user~p1", name: "Homepage", version: 1, decision: "pending", updatedAt: "", ...over,
});
const proof = (over: { [K in keyof OpenProof]?: OpenProof[K] | undefined } = {}): OpenProof => ({
  id: "user~p1", name: "Homepage", version: 1, decision: "pending", updatedAt: "",
  deliverable: { kind: "image", url: "https://cdn/x.png" }, annotations: [{ id: "a1", type: "pin", x: 0.2, y: 0.2, text: "logo" }],
  storage: "user", ...over,
} as OpenProof);

/** Render, then open the seeded proof by clicking its nav link (mounts the header + overlay). */
function openView() {
  const view = renderWithProviders(<Proofs />);
  fireEvent.click(screen.getByTestId("proof-link-user~p1"));
  return view;
}

beforeEach(() => {
  role = "contributor";
  proofsData = [];
  proofsError = false;
  openProof = null;
  commentsOn = false;
  createPending = savePending = delPending = decidePending = false;
  createMode = saveMode = delMode = decideMode = "ok";
  decideResult = null;
  errValue = new Error("boom");
  toast.mockClear(); createMutate.mockClear(); saveMutate.mockClear(); delMutate.mockClear(); decideMutate.mockClear();
});

describe("Proofs page", () => {
  it("shows the unsupported notice when the proofs query errors (501)", () => {
    proofsError = true;
    renderWithProviders(<Proofs />);
    expect(screen.getByTestId("proofs-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("proofs-nav")).not.toBeInTheDocument();
  });

  it("renders the empty state and the no-selection placeholder", () => {
    renderWithProviders(<Proofs />);
    expect(screen.getByTestId("proofs-empty")).toBeInTheDocument();
    expect(screen.getByTestId("proofs-no-selection")).toBeInTheDocument();
  });

  it("lists proofs with per-decision badges", () => {
    proofsData = [
      listItem({ id: "user~a", name: "A", decision: "pending" }),
      listItem({ id: "user~b", name: "B", decision: "approved" }),
      listItem({ id: "user~c", name: "C", decision: "rejected" }),
      listItem({ id: "user~d", name: "D", decision: "changes-requested" }),
    ];
    renderWithProviders(<Proofs />);
    expect(screen.getByTestId("proof-link-user~a")).toHaveTextContent("Pending");
    expect(screen.getByTestId("proof-link-user~b")).toHaveTextContent("Approved");
    expect(screen.getByTestId("proof-link-user~c")).toHaveTextContent("Rejected");
    expect(screen.getByTestId("proof-link-user~d")).toHaveTextContent("Changes requested");
  });

  it("tolerates a non-array proofs payload (guards Array.isArray)", () => {
    proofsData = { not: "an array" };
    renderWithProviders(<Proofs />);
    expect(screen.getByTestId("proofs-empty")).toBeInTheDocument();
  });

  // --- Open a proof: header badges + overlay. ---
  it("opens a proof into the overlay with storage + decision badges", () => {
    proofsData = [listItem()];
    openProof = proof({ storage: "org", decision: "approved", version: 3, decidedBy: "boss" });
    role = "manager";
    openView();
    expect(screen.getByRole("heading", { level: 2, name: "Homepage" })).toBeInTheDocument();
    expect(screen.getByTestId("proof-storage-badge")).toHaveTextContent("Org-wide");
    expect(screen.getByTestId("proof-decision-badge")).toHaveTextContent(/Approved · v3/);
    expect(screen.getByTestId("annotation-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("proof-decision-bar")).toHaveTextContent(/by boss/);
  });

  it("defaults the storage badge to Personal when storage is omitted", () => {
    proofsData = [listItem()];
    openProof = proof({ storage: undefined });
    openView();
    expect(screen.getByTestId("proof-storage-badge")).toHaveTextContent("Personal");
  });

  // --- RBAC. ---
  it("hides authoring + decision controls from a viewer (overlay read-only)", () => {
    role = "viewer";
    proofsData = [listItem()];
    openProof = proof();
    openView();
    expect(screen.queryByTestId("proof-new-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proof-decision-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proof-save")).not.toBeInTheDocument();
    expect(screen.getByTestId("annotation-overlay")).toHaveAttribute("data-readonly", "true");
  });

  it("offers the org-wide storage option only to a manager", () => {
    role = "contributor";
    const { unmount } = renderWithProviders(<Proofs />);
    expect(screen.queryByRole("option", { name: "Org-wide" })).not.toBeInTheDocument();
    unmount();
    role = "manager";
    renderWithProviders(<Proofs />);
    expect(screen.getByRole("option", { name: "Org-wide" })).toBeInTheDocument();
  });

  // --- Create. ---
  it("guards create when name or url is missing", () => {
    renderWithProviders(<Proofs />);
    fireEvent.click(screen.getByTestId("proof-new"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "NAME + URL REQUIRED", variant: "destructive" }));
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("creates a proof and toasts success with the storage label", () => {
    openProof = proof({ id: "new~p" });
    renderWithProviders(<Proofs />);
    fireEvent.change(screen.getByTestId("proof-new-name"), { target: { value: "Landing" } });
    fireEvent.change(screen.getByTestId("proof-new-url"), { target: { value: "https://cdn/l.png" } });
    fireEvent.change(screen.getByTestId("proof-new-kind"), { target: { value: "pdf" } });
    fireEvent.click(screen.getByTestId("proof-new"));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Landing", deliverable: { kind: "pdf", url: "https://cdn/l.png" }, annotations: [], storage: "user",
    }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "PROOF CREATED", description: expect.stringContaining("Personal") }));
  });

  it("toasts a destructive error when create fails (Error message)", () => {
    createMode = "err";
    renderWithProviders(<Proofs />);
    fireEvent.change(screen.getByTestId("proof-new-name"), { target: { value: "L" } });
    fireEvent.change(screen.getByTestId("proof-new-url"), { target: { value: "u" } });
    fireEvent.click(screen.getByTestId("proof-new"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT CREATE", description: "boom", variant: "destructive" }));
  });

  it("falls back to a generic message when create rejects with a non-Error", () => {
    createMode = "err"; errValue = "weird";
    renderWithProviders(<Proofs />);
    fireEvent.change(screen.getByTestId("proof-new-name"), { target: { value: "L" } });
    fireEvent.change(screen.getByTestId("proof-new-url"), { target: { value: "u" } });
    fireEvent.click(screen.getByTestId("proof-new"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT CREATE", description: "Try again." }));
  });

  // --- Save (gated on dirty). ---
  it("keeps Save disabled until an overlay edit dirties the proof, then saves", () => {
    proofsData = [listItem()];
    openProof = proof();
    openView();
    expect(screen.getByTestId("proof-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("stub-ann-change")); // onChange → dirty
    expect(screen.getByTestId("proof-save")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("proof-save"));
    expect(saveMutate).toHaveBeenCalledWith(expect.objectContaining({ name: "Homepage", annotations: [{ id: "a1", type: "pin", x: 0.1, y: 0.1 }] }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "PROOF SAVED" }));
  });

  it("toasts a destructive error when save fails", () => {
    saveMode = "err";
    proofsData = [listItem()];
    openProof = proof();
    openView();
    fireEvent.click(screen.getByTestId("stub-ann-change"));
    fireEvent.click(screen.getByTestId("proof-save"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", variant: "destructive" }));
  });

  it("shows a Saving… affordance while the save is pending", () => {
    savePending = true;
    proofsData = [listItem()];
    openProof = proof();
    openView();
    expect(screen.getByTestId("proof-save")).toHaveTextContent(/Saving…/i);
  });

  // --- Delete (org gate + outcomes). ---
  it("deletes a proof, clears the selection and toasts", () => {
    proofsData = [listItem()];
    openProof = proof();
    openView();
    fireEvent.click(screen.getByTestId("proof-delete"));
    expect(delMutate).toHaveBeenCalledWith("user~p1");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "PROOF DELETED" }));
    // proofId reset → the no-selection placeholder returns.
    expect(screen.getByTestId("proofs-no-selection")).toBeInTheDocument();
  });

  it("toasts a destructive error when delete fails", () => {
    delMode = "err";
    proofsData = [listItem()];
    openProof = proof();
    openView();
    fireEvent.click(screen.getByTestId("proof-delete"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT DELETE", variant: "destructive" }));
  });

  it("hides Delete on an org proof from a contributor but shows it to a manager", () => {
    proofsData = [listItem()];
    openProof = proof({ storage: "org" });

    role = "contributor";
    const { unmount } = openView();
    expect(screen.queryByTestId("proof-delete")).not.toBeInTheDocument();
    unmount();

    role = "manager";
    openView();
    expect(screen.getByTestId("proof-delete")).toBeInTheDocument();
  });

  // --- Decision bar: applied, held-for-sign-off, error. ---
  it("records an applied decision and toasts the version", () => {
    decideResult = { ...proof(), decision: "approved", decisionVersion: 2 };
    proofsData = [listItem()];
    openProof = proof();
    openView();
    fireEvent.click(screen.getByTestId("proof-approve"));
    expect(decideMutate).toHaveBeenCalledWith("approved");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "DECISION RECORDED", description: expect.stringContaining("Approved · v2") }));
  });

  it("falls back to the proof version when no decisionVersion is returned", () => {
    decideResult = { ...proof({ version: 5 }), decision: "rejected" };
    proofsData = [listItem()];
    openProof = proof();
    openView();
    fireEvent.click(screen.getByTestId("proof-reject"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("v5") }));
  });

  it("routes a held decision to the sign-off notice", () => {
    decideResult = { pending: { proposalId: "x", action: "proof.decision" } };
    proofsData = [listItem()];
    openProof = proof();
    openView();
    fireEvent.click(screen.getByTestId("proof-changes"));
    expect(decideMutate).toHaveBeenCalledWith("changes-requested");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "SENT FOR SIGN-OFF" }));
  });

  it("toasts a destructive error when the decision fails", () => {
    decideMode = "err";
    proofsData = [listItem()];
    openProof = proof();
    openView();
    fireEvent.click(screen.getByTestId("proof-approve"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT DECIDE", variant: "destructive" }));
  });

  // --- Threaded review: gated on the comments feature; general vs per-annotation. ---
  it("does not render the review thread when comments are off", () => {
    commentsOn = false;
    proofsData = [listItem()];
    openProof = proof();
    openView();
    expect(screen.queryByTestId("proof-review-thread")).not.toBeInTheDocument();
  });

  it("shows the general thread, then switches to a per-annotation thread on select", () => {
    commentsOn = true;
    proofsData = [listItem()];
    openProof = proof();
    openView();
    const thread = screen.getByTestId("proof-review-thread");
    expect(thread).toHaveTextContent(/General review/i);
    expect(screen.getByTestId("comments-panel")).toHaveAttribute("data-room", "proof:user~p1");
    // Select the seeded annotation → a per-annotation thread keyed to it.
    fireEvent.click(screen.getByTestId("stub-ann-select"));
    expect(screen.getByTestId("proof-review-thread")).toHaveTextContent(/annotation 1/i);
    expect(screen.getByTestId("comments-panel")).toHaveAttribute("data-room", "proof:user~p1#a1");
    // Deselect → back to the general thread.
    fireEvent.click(screen.getByTestId("stub-ann-deselect"));
    expect(screen.getByTestId("proof-review-thread")).toHaveTextContent(/General review/i);
  });
});
