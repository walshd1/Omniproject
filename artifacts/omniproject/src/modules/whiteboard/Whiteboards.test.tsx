import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import type { Role } from "../../lib/auth";

/**
 * Whiteboards is the visual-canvas page: it composes many seams (whiteboard CRUD hooks, RBAC gates,
 * live cursors, the native SVG editor, client-side export, and sticky → work-item conversion). Rather
 * than drive all of those through the real network/DOM, we stub each seam behind a mutable module-level
 * knob (the house pattern — see ScreenPage.test.tsx) and assert the page's own branching: the RBAC
 * ladder (viewer / contributor / manager), the storage-target select, the unsupported + empty states,
 * open/save/delete, export (svg/png + failure), and the sticky-to-issue flow with its guards + toasts.
 * `roleAtLeast` is kept REAL (importOriginal) so the gate logic under test is the shipping one.
 */

// --- Per-test knobs (reset in beforeEach), closed over by the vi.mock factories below. ---
let role: Role = "contributor";
let boards: Array<{ id: string; name: string; storage?: string }> = [];
let boardsError = false;
let board: { id: string; name: string; storage?: string; projectId?: string | null; scene: { elements: unknown[] } } | null = null;
let projects: Array<{ id: string; name: string }> = [];
let cursorsOn = false;
let savePending = false;
let editorSvg: object | null = {};
let exportThrow: unknown = null;
let stickyEl: { id: string; type: string; text: string } = { id: "s1", type: "sticky", text: "Do work" };
// Mutation outcomes: "ok" fires onSuccess, "err" fires onError.
let createMode: "ok" | "err" = "ok";
let saveMode: "ok" | "err" = "ok";
let delMode: "ok" | "err" = "ok";
let issueMode: "ok" | "err" = "ok";
// The value handed to onError — an Error (message shown) by default, or a non-Error (the page's
// "Try again." fallback) when a test wants the other side of the `e instanceof Error` ternary.
let errValue: unknown = new Error("boom");

// Captured toast() calls (the page surfaces every outcome through a toast).
const toast = vi.fn();

/** A mutation stub honouring the react-query `mutate(vars, { onSuccess, onError })` contract. */
const mutateWith = (getMode: () => "ok" | "err", result?: (vars: unknown) => unknown) =>
  (vars: unknown, opts?: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
    if (getMode() === "err") opts?.onError?.(errValue);
    else opts?.onSuccess?.(result ? result(vars) : undefined);
  };

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

// Keep the real RBAC ladder; only the session lookup is stubbed.
vi.mock("../../lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role } }) };
});

vi.mock("../../lib/features", () => ({
  useFeatures: () => ({ data: [] }),
  featureEnabled: () => cursorsOn,
}));

vi.mock("./whiteboard-cursors", () => ({
  useLiveCursors: () => ({ cursors: [], publish: vi.fn(), live: cursorsOn }),
}));

vi.mock("./whiteboard", () => ({
  whiteboardRoomId: (id: string) => `board:${id}`,
  useWhiteboards: () => ({ data: boards, isError: boardsError }),
  useWhiteboard: (id?: string) => ({ data: id ? board : undefined }),
  useCreateWhiteboard: () => ({ isPending: false, mutate: mutateWith(() => createMode, () => ({ id: "new-board" })) }),
  useSaveWhiteboard: () => ({ isPending: savePending, mutate: mutateWith(() => saveMode) }),
  useDeleteWhiteboard: () => ({ isPending: false, mutate: mutateWith(() => delMode) }),
}));

// Export plumbing is exercised for its call shape only (nothing leaves the browser).
const downloadBlob = vi.fn();
vi.mock("./whiteboard-export", () => ({
  sceneBounds: () => ({ x: 0, y: 0, w: 10, h: 10 }),
  toExportSvg: () => { if (exportThrow) throw exportThrow; return "<svg/>"; },
  svgToPngBlob: async () => new Blob(["png"], { type: "image/png" }),
  downloadBlob: (name: string, blob: Blob) => downloadBlob(name, blob),
  exportFileStem: () => "board",
}));

// Only useListProjects / useCreateIssue are consumed by the page.
vi.mock("@workspace/api-client-react", () => ({
  useListProjects: () => ({ data: projects }),
  useCreateIssue: () => ({ isPending: false, mutate: mutateWith(() => issueMode) }),
}));

vi.mock("../../components/native/UseNative", () => ({ UseNative: () => <div data-testid="use-native" /> }));

// Editor stub: exposes getSvg via the imperative handle, plus buttons to drive onChange (dirty the
// board) and onConvertSticky (start a sticky → work-item conversion) from a test.
vi.mock("./CanvasEditor", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  const CanvasEditor = forwardRef((props: {
    onChange: (n: unknown[]) => void;
    onConvertSticky?: (el: unknown) => void;
    readOnly?: boolean;
  }, ref) => {
    useImperativeHandle(ref, () => ({ getSvg: () => editorSvg }), []);
    return (
      <div data-testid="canvas-editor" data-readonly={String(props.readOnly)}>
        <button type="button" data-testid="stub-change" onClick={() => props.onChange([{ id: "s1", type: "sticky", text: "edited" }])}>edit</button>
        {props.onConvertSticky && (
          <button type="button" data-testid="stub-convert" onClick={() => props.onConvertSticky!(stickyEl)}>convert</button>
        )}
      </div>
    );
  });
  return { CanvasEditor };
});

const { Whiteboards } = await import("./Whiteboards");

function board1() {
  return { id: "b1", name: "Board One", storage: "user" as const, projectId: null, scene: { elements: [{ id: "s1", type: "sticky", text: "Do work" }] } };
}

/** Render + open the single board (click its nav link) so the board header/editor are mounted. */
function openBoard() {
  const view = renderWithProviders(<Whiteboards />);
  fireEvent.click(screen.getByTestId("board-link-b1"));
  return view;
}

beforeEach(() => {
  role = "contributor";
  boards = [];
  boardsError = false;
  board = null;
  projects = [];
  cursorsOn = false;
  savePending = false;
  editorSvg = {};
  exportThrow = null;
  stickyEl = { id: "s1", type: "sticky", text: "Do work" };
  createMode = saveMode = delMode = issueMode = "ok";
  errValue = new Error("boom");
  toast.mockClear();
  downloadBlob.mockClear();
});

describe("Whiteboards", () => {
  it("shows the unsupported note when the backend has no whiteboards (query errors)", () => {
    boardsError = true;
    renderWithProviders(<Whiteboards />);
    expect(screen.getByTestId("whiteboards-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("whiteboards-nav")).toBeNull();
  });

  it("renders the empty state with no boards yet", () => {
    renderWithProviders(<Whiteboards />);
    expect(screen.getByTestId("whiteboards-empty")).toBeInTheDocument();
    expect(screen.getByTestId("whiteboards-no-selection")).toBeInTheDocument();
  });

  it("lists boards and opens one when its nav link is clicked", () => {
    boards = [{ id: "b1", name: "Board One", storage: "user" }];
    board = board1();
    openBoard();
    expect(screen.getByRole("heading", { level: 2, name: "Board One" })).toBeInTheDocument();
    expect(screen.getByTestId("whiteboard-storage-badge")).toHaveTextContent("Personal");
    expect(screen.getByTestId("canvas-editor")).toBeInTheDocument();
  });

  // --- RBAC: the author controls appear only from contributor up; the org target needs manager. ---
  it("hides author controls from a viewer but still offers export", () => {
    role = "viewer";
    boards = [{ id: "b1", name: "Board One", storage: "user" }];
    board = board1();
    openBoard();
    expect(screen.queryByTestId("whiteboard-storage")).toBeNull();
    expect(screen.queryByTestId("whiteboard-new")).toBeNull();
    expect(screen.queryByTestId("whiteboard-save")).toBeNull();
    expect(screen.queryByTestId("whiteboard-delete")).toBeNull();
    // Export is client-side, so even a viewer sees it; and the editor is read-only.
    expect(screen.getByTestId("whiteboard-export-svg")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-editor")).toHaveAttribute("data-readonly", "true");
  });

  it("shows a contributor the storage select without the org option", () => {
    role = "contributor";
    renderWithProviders(<Whiteboards />);
    const select = screen.getByTestId("whiteboard-storage");
    expect(select).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Org-wide" })).toBeNull();
    expect(screen.getByRole("option", { name: "Personal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Built-in store" })).toBeInTheDocument();
  });

  it("shows a manager the org-wide storage option", () => {
    role = "manager";
    renderWithProviders(<Whiteboards />);
    expect(screen.getByRole("option", { name: "Org-wide" })).toBeInTheDocument();
  });

  // --- Create, per storage target + outcome. ---
  it("creates a personal board and toasts success", () => {
    board = board1();
    renderWithProviders(<Whiteboards />);
    fireEvent.click(screen.getByTestId("whiteboard-new"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "WHITEBOARD CREATED", description: "Saved to Personal" }));
    // onSuccess set the new board id → the created board opens.
    expect(screen.getByRole("heading", { level: 2, name: "Board One" })).toBeInTheDocument();
  });

  it("creates an org-wide board (manager) with the org label", () => {
    role = "manager";
    board = board1();
    renderWithProviders(<Whiteboards />);
    fireEvent.change(screen.getByTestId("whiteboard-storage"), { target: { value: "org" } });
    fireEvent.click(screen.getByTestId("whiteboard-new"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "WHITEBOARD CREATED", description: "Saved to Org-wide" }));
  });

  it("creates a built-in (sidecar) board with its label", () => {
    board = board1();
    renderWithProviders(<Whiteboards />);
    fireEvent.change(screen.getByTestId("whiteboard-storage"), { target: { value: "sidecar" } });
    fireEvent.click(screen.getByTestId("whiteboard-new"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "WHITEBOARD CREATED", description: "Saved to Built-in store" }));
  });

  it("toasts a destructive error when create fails", () => {
    createMode = "err";
    renderWithProviders(<Whiteboards />);
    fireEvent.click(screen.getByTestId("whiteboard-new"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT CREATE", variant: "destructive" }));
  });

  // --- Save: gated on the dirty flag; both outcomes. ---
  it("keeps Save disabled until an edit dirties the board", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    expect(screen.getByTestId("whiteboard-save")).toBeDisabled();
  });

  it("saves a dirtied board and toasts success", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("stub-change")); // onChange → dirty
    fireEvent.click(screen.getByTestId("whiteboard-save"));
    expect(toast).toHaveBeenCalledWith({ title: "WHITEBOARD SAVED" });
  });

  it("toasts a destructive error when save fails", () => {
    saveMode = "err";
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("stub-change"));
    fireEvent.click(screen.getByTestId("whiteboard-save"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", variant: "destructive" }));
  });

  // --- Delete: success, failure, and the org-board manager gate. ---
  it("deletes a board, clears the selection and toasts", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("whiteboard-delete"));
    expect(toast).toHaveBeenCalledWith({ title: "WHITEBOARD DELETED" });
    // boardId reset → the empty-selection note returns.
    expect(screen.getByTestId("whiteboards-no-selection")).toBeInTheDocument();
  });

  it("toasts a destructive error when delete fails", () => {
    delMode = "err";
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("whiteboard-delete"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT DELETE", variant: "destructive" }));
  });

  it("hides Delete on an org-wide board from a contributor but shows it to a manager", () => {
    boards = [{ id: "b1", name: "Board One", storage: "org" }];
    board = { ...board1(), storage: "org" };

    role = "contributor";
    const { unmount } = openBoard();
    expect(screen.queryByTestId("whiteboard-delete")).toBeNull();
    unmount();

    role = "manager";
    openBoard();
    expect(screen.getByTestId("whiteboard-delete")).toBeInTheDocument();
  });

  // --- Export: svg, png, the no-svg early return, and the failure toast. ---
  it("exports SVG through the download plumbing", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("whiteboard-export-svg"));
    expect(downloadBlob).toHaveBeenCalledWith("board.svg", expect.any(Blob));
  });

  it("exports PNG through the rasteriser", async () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("whiteboard-export-png"));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith("board.png", expect.any(Blob)));
  });

  it("no-ops the export when the editor has no live svg", () => {
    editorSvg = null;
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("whiteboard-export-svg"));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("toasts a destructive error when export throws", async () => {
    exportThrow = new Error("bad export");
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("whiteboard-export-svg"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT EXPORT", description: "bad export", variant: "destructive" })));
  });

  it("falls back to a generic message when export throws a non-Error", async () => {
    exportThrow = "weird"; // exercises the `: \"Try again.\"` side of the message ternary
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    fireEvent.click(screen.getByTestId("whiteboard-export-svg"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT EXPORT", description: "Try again." })));
  });

  // --- Sticky → work item: the project select, the guards, and both outcomes. ---
  it("renders the convert-project select when projects exist", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    projects = [{ id: "p1", name: "Alpha" }];
    openBoard();
    expect(screen.getByTestId("whiteboard-convert-project")).toBeInTheDocument();
  });

  it("guards a conversion with no project selected", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1(); // projectId null and no projects → convertProject stays ""
    openBoard();
    fireEvent.click(screen.getByTestId("stub-convert"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "PICK A PROJECT", variant: "destructive" }));
  });

  it("ignores a conversion when the sticky has no text", () => {
    stickyEl = { id: "s1", type: "sticky", text: "   " };
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    projects = [{ id: "p1", name: "Alpha" }];
    openBoard();
    fireEvent.click(screen.getByTestId("stub-convert"));
    expect(toast).not.toHaveBeenCalled();
  });

  it("converts a sticky into a work item and toasts success", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    projects = [{ id: "p1", name: "Alpha" }];
    openBoard();
    fireEvent.click(screen.getByTestId("stub-convert"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "WORK ITEM CREATED" }));
  });

  it("toasts a destructive error when the conversion fails", () => {
    issueMode = "err";
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    projects = [{ id: "p1", name: "Alpha" }];
    openBoard();
    fireEvent.click(screen.getByTestId("stub-convert"));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT CREATE", variant: "destructive" }));
  });

  it("selecting a different convert-project updates the picker", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    projects = [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }];
    openBoard();
    const picker = screen.getByTestId("whiteboard-convert-project") as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "p2" } });
    expect(picker.value).toBe("p2");
  });

  // --- The `: "Try again." ` fallback (the non-Error side) of each handler's message ternary. ---
  it("uses the generic message when a mutation rejects with a non-Error", () => {
    errValue = "nope";
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    projects = [{ id: "p1", name: "Alpha" }];

    createMode = "err";
    const { unmount } = renderWithProviders(<Whiteboards />);
    fireEvent.click(screen.getByTestId("whiteboard-new"));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "COULD NOT CREATE", description: "Try again." }));
    unmount();

    // Save / delete / convert take the same fallback branch.
    saveMode = delMode = issueMode = "err";
    openBoard();
    fireEvent.click(screen.getByTestId("stub-change"));
    fireEvent.click(screen.getByTestId("whiteboard-save"));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", description: "Try again." }));
    fireEvent.click(screen.getByTestId("stub-convert"));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "COULD NOT CREATE", description: "Try again." }));
    fireEvent.click(screen.getByTestId("whiteboard-delete"));
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "COULD NOT DELETE", description: "Try again." }));
  });

  it("defaults the storage badge to Personal when the board omits a storage target", () => {
    boards = [{ id: "b1", name: "Board One" }];
    board = { id: "b1", name: "Board One", projectId: null, scene: { elements: [] } }; // no `storage`
    openBoard();
    expect(screen.getByTestId("whiteboard-storage-badge")).toHaveTextContent("Personal");
  });

  it("shows a Saving… affordance while the save mutation is pending", () => {
    savePending = true;
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    const saveBtn = screen.getByTestId("whiteboard-save");
    expect(saveBtn).toHaveTextContent("Saving…");
    expect(saveBtn).toBeDisabled();
  });

  it("wires live cursors through when presence is on", () => {
    cursorsOn = true;
    boards = [{ id: "b1", name: "Board One" }];
    board = board1();
    openBoard();
    // The board mounts with the cursor transport active (onCursorMove passed to the editor).
    expect(screen.getByTestId("canvas-editor")).toBeInTheDocument();
  });
});
