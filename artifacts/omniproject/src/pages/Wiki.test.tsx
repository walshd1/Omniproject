import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import type { WikiDoc, WikiDocSummary } from "../lib/wiki";
import type { FeatureStatus } from "../lib/features";
import type { Role } from "../lib/auth";

/**
 * Wiki page — spaces → docs browsing, RBAC-gated authoring (create/edit/delete on a chosen storage
 * target), version-history restore, page nesting, backlinks and the live-collab (presence/comments)
 * seams. The wiki lib HOOKS are mocked (the pure tree/id helpers stay real via importOriginal), the
 * child editor/history/renderer/presence/comments components are stubbed to buttons, and `roleAtLeast`
 * stays real so the role ladder is exercised for real. A mutable `h` holder drives each case's data.
 */

// Hoisted mutable state shared with the vi.mock factories below.
const h = vi.hoisted(() => ({
  role: "manager" as Role,
  spacesQ: { data: undefined as unknown, isError: false },
  docsQ: { data: [] as WikiDocSummary[] },
  docQ: { data: undefined as WikiDoc | undefined },
  createMut: { mutate: vi.fn(), isPending: false },
  saveMut: { mutate: vi.fn(), isPending: false },
  delMut: { mutate: vi.fn(), isPending: false },
  features: undefined as FeatureStatus[] | undefined,
  peers: [] as Array<{ id: string }>,
  toast: vi.fn(),
}));

vi.mock("../lib/wiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/wiki")>();
  return {
    ...actual, // keep the real wikiRoomId / wikiDocStorage / buildDocTree / flattenDocTree helpers
    useWikiSpaces: () => h.spacesQ,
    useWikiDocs: () => h.docsQ,
    useWikiDoc: () => h.docQ,
    useCreateWikiDoc: () => h.createMut,
    useSaveWikiDoc: () => h.saveMut,
    useDeleteWikiDoc: () => h.delMut,
  };
});

vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, useAuth: () => ({ data: { role: h.role } }) }; // roleAtLeast stays real
});

vi.mock("../lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/features")>();
  return { ...actual, useFeatures: () => ({ data: h.features }) }; // featureEnabled stays real
});

vi.mock("../lib/presence", () => ({ usePresence: () => ({ peers: h.peers }) }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));

// Child components stubbed to the minimum surface each interaction needs.
vi.mock("../components/wiki/DocEditor", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DocEditor: ({ onSave, onCancel, saving }: any) => (
    <div data-testid="doc-editor">
      <span data-testid="editor-saving">{String(saving)}</span>
      <button data-testid="editor-save" onClick={() => onSave({ spaceId: "s1", title: "New Title", blocks: [], parentId: null })}>save</button>
      <button data-testid="editor-cancel" onClick={onCancel}>cancel</button>
    </div>
  ),
}));
vi.mock("../components/wiki/DocHistory", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DocHistory: ({ onRestore, onClose }: any) => (
    <div data-testid="doc-history">
      <button data-testid="history-restore" onClick={() => onRestore({ versionId: "v1", docId: "d1", at: "", title: "Old Title", blocks: [] })}>restore</button>
      <button data-testid="history-close" onClick={onClose}>close</button>
    </div>
  ),
}));
vi.mock("../components/wiki/DocRenderer", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DocRenderer: ({ blocks }: any) => <div data-testid="doc-renderer">{blocks?.length ?? 0} blocks</div>,
}));
vi.mock("../components/presence/PresenceAvatars", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PresenceAvatars: ({ peers }: any) => <div data-testid="presence-avatars">{peers.length}</div>,
}));
vi.mock("../components/issue-dialog/CommentsPanel", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CommentsPanel: ({ roomId }: any) => <div data-testid="comments-panel">{roomId}</div>,
}));

// Imported after the mocks are registered.
import { Wiki } from "./Wiki";

function summary(over: Partial<WikiDocSummary> = {}): WikiDocSummary {
  return { id: "user~d1", spaceId: "s1", slug: "d1", title: "Doc One", updatedAt: "", parentId: null, ...over };
}
function doc(over: Partial<WikiDoc> = {}): WikiDoc {
  return { ...summary(), blocks: [{ id: "b1", type: "paragraph", text: "hi" }], backlinks: [], ...over } as WikiDoc;
}
const space = (id: string, name = id.toUpperCase()) => ({ id, key: id, name });

beforeEach(() => {
  h.role = "manager";
  h.spacesQ = { data: [space("s1"), space("s2")], isError: false };
  h.docsQ = { data: [] };
  h.docQ = { data: undefined };
  h.features = undefined;
  h.peers = [];
  h.toast = vi.fn();
  // Default mutation behaviour: succeed. Error cases override per test.
  h.createMut = { mutate: vi.fn((input, opts) => opts?.onSuccess?.({ ...doc(), id: "user~created", title: input.title })), isPending: false };
  h.saveMut = { mutate: vi.fn((_input, opts) => opts?.onSuccess?.()), isPending: false };
  h.delMut = { mutate: vi.fn((_id, opts) => opts?.onSuccess?.()), isPending: false };
});

describe("Wiki", () => {
  it("shows the unsupported notice when the backend has no knowledge base (501 → hook error)", () => {
    h.spacesQ = { data: undefined, isError: true };
    renderWithProviders(<Wiki />);
    expect(screen.getByTestId("wiki-unsupported")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-nav")).toBeNull();
  });

  it("lists spaces, nests child pages under their parent, and marks the active space", () => {
    h.docsQ = { data: [summary({ id: "user~parent", title: "Parent" }), summary({ id: "user~child", title: "Child", parentId: "user~parent" })] };
    renderWithProviders(<Wiki />);
    // Both spaces render; the effect defaults the selection to the first one.
    expect(screen.getByTestId("space-s1").className).toMatch(/font-bold/);
    expect(screen.getByTestId("space-s2").className).not.toMatch(/font-bold/);
    // Parent depth 0, child depth 1 (indented, with the ↳ marker).
    expect(screen.getByTestId("doc-link-user~parent").getAttribute("data-depth")).toBe("0");
    const child = screen.getByTestId("doc-link-user~child");
    expect(child.getAttribute("data-depth")).toBe("1");
    expect(child.textContent).toContain("↳");
  });

  it("shows the empty state when a space has no documents", () => {
    h.docsQ = { data: [] };
    renderWithProviders(<Wiki />);
    expect(screen.getByTestId("wiki-docs-empty")).toBeInTheDocument();
  });

  it("switches spaces, filtering the doc list to the selected space", () => {
    h.docsQ = { data: [summary({ id: "user~a", spaceId: "s1", title: "In S1" }), summary({ id: "user~b", spaceId: "s2", title: "In S2" })] };
    renderWithProviders(<Wiki />);
    expect(screen.getByTestId("doc-link-user~a")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-link-user~b")).toBeNull();
    fireEvent.click(screen.getByTestId("space-s2"));
    expect(screen.getByTestId("doc-link-user~b")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-link-user~a")).toBeNull();
  });

  it("renders the no-selection prompt when no document is open", () => {
    renderWithProviders(<Wiki />);
    expect(screen.getByTestId("wiki-no-selection")).toBeInTheDocument();
  });

  it("renders an open document with its storage badge, body, backlinks and comments", () => {
    h.docQ = { data: doc({ id: "org~d9", title: "Big Doc", backlinks: [{ id: "user~ref", title: "Refers here", slug: "r", spaceId: "s2" }] }) };
    renderWithProviders(<Wiki />);
    expect(screen.getByRole("heading", { level: 2, name: "Big Doc" })).toBeInTheDocument();
    expect(screen.getByTestId("wiki-storage-badge").textContent).toContain("Org-wide");
    expect(screen.getByTestId("doc-renderer").textContent).toContain("1 blocks");
    const backlinks = screen.getByTestId("wiki-backlinks");
    expect(within(backlinks).getByText("Refers here")).toBeInTheDocument();
    expect(screen.getByTestId("comments-panel")).toBeInTheDocument();
    // Navigating via a backlink re-targets the space + doc without throwing.
    fireEvent.click(within(backlinks).getByText("Refers here"));
  });

  it("shows presence avatars only while peers are present", () => {
    h.docQ = { data: doc() };
    h.peers = [{ id: "u1" }, { id: "u2" }];
    renderWithProviders(<Wiki />);
    expect(screen.getByTestId("presence-avatars").textContent).toBe("2");
  });

  it("hides comments and presence when those feature modules are disabled", () => {
    h.docQ = { data: doc() };
    h.peers = [{ id: "u1" }];
    h.features = [
      { id: "comments", enabled: false } as FeatureStatus,
      { id: "presence", enabled: false } as FeatureStatus,
    ];
    renderWithProviders(<Wiki />);
    expect(screen.queryByTestId("comments-panel")).toBeNull();
    expect(screen.queryByTestId("presence-avatars")).toBeNull();
  });

  it("hides all authoring controls for a viewer", () => {
    h.role = "viewer";
    h.docQ = { data: doc() };
    renderWithProviders(<Wiki />);
    expect(screen.queryByTestId("wiki-storage")).toBeNull();
    expect(screen.queryByTestId("wiki-new-doc")).toBeNull();
    expect(screen.queryByTestId("wiki-edit-doc")).toBeNull();
    expect(screen.queryByTestId("wiki-delete-doc")).toBeNull();
    // The history toggle is available to any reader.
    expect(screen.getByTestId("wiki-history-toggle")).toBeInTheDocument();
  });

  it("offers a contributor Personal + Built-in targets but not the org-wide one", () => {
    h.role = "contributor";
    renderWithProviders(<Wiki />);
    const select = screen.getByTestId("wiki-storage") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["user", "sidecar"]);
  });

  it("offers a manager the org-wide storage target", () => {
    h.role = "manager";
    renderWithProviders(<Wiki />);
    const select = screen.getByTestId("wiki-storage") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["user", "org", "sidecar"]);
  });

  it("creates a document on the chosen storage target and toasts success", () => {
    h.role = "contributor";
    renderWithProviders(<Wiki />);
    // Pick a non-default target BEFORE entering new mode (the selector hides in new mode).
    fireEvent.change(screen.getByTestId("wiki-storage"), { target: { value: "sidecar" } });
    fireEvent.click(screen.getByTestId("wiki-new-doc"));
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.createMut.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ storage: "sidecar", title: "New Title" }),
      expect.any(Object),
    );
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "DOCUMENT CREATED", description: expect.stringContaining("Built-in store") }));
  });

  it("surfaces an error toast when create fails", () => {
    h.role = "contributor";
    h.createMut = { mutate: vi.fn((_i, opts) => opts?.onError?.(new Error("nope"))), isPending: false };
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("wiki-new-doc"));
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT CREATE", description: "nope", variant: "destructive" }));
  });

  it("falls back to a generic message when a create error is not an Error", () => {
    h.role = "contributor";
    h.createMut = { mutate: vi.fn((_i, opts) => opts?.onError?.("weird")), isPending: false };
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("wiki-new-doc"));
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT CREATE", description: "Try again." }));
  });

  it("cancels out of the new-document editor back to view", () => {
    h.role = "contributor";
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("wiki-new-doc"));
    expect(screen.getByTestId("doc-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("editor-cancel"));
    expect(screen.queryByTestId("doc-editor")).toBeNull();
  });

  it("edits and saves a document, toasting success", () => {
    h.role = "contributor";
    h.docQ = { data: doc() };
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("wiki-edit-doc"));
    expect(screen.getByTestId("doc-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.saveMut.mutate).toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "DOCUMENT SAVED", description: "New Title" }));
  });

  it("surfaces an error toast when save fails", () => {
    h.role = "contributor";
    h.docQ = { data: doc() };
    h.saveMut = { mutate: vi.fn((_i, opts) => opts?.onError?.(new Error("save boom"))), isPending: false };
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("wiki-edit-doc"));
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT SAVE", variant: "destructive" }));
  });

  it("deletes the open document and toasts success", () => {
    h.role = "contributor";
    h.docsQ = { data: [summary()] };
    h.docQ = { data: doc() };
    renderWithProviders(<Wiki />);
    // Open the doc from the list so docId is set, then delete.
    fireEvent.click(screen.getByTestId("doc-link-user~d1"));
    fireEvent.click(screen.getByTestId("wiki-delete-doc"));
    expect(h.delMut.mutate).toHaveBeenCalledWith("user~d1", expect.any(Object));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "DOCUMENT DELETED" }));
  });

  it("surfaces an error toast when delete fails", () => {
    h.role = "contributor";
    h.docsQ = { data: [summary()] };
    h.docQ = { data: doc() };
    h.delMut = { mutate: vi.fn((_id, opts) => opts?.onError?.(new Error("del boom"))), isPending: false };
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("doc-link-user~d1"));
    fireEvent.click(screen.getByTestId("wiki-delete-doc"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT DELETE", variant: "destructive" }));
  });

  it("does not attempt a delete when no document id is set", () => {
    h.role = "contributor";
    h.docQ = { data: doc() }; // article shows, but docId is still "" (never opened from the list)
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("wiki-delete-doc"));
    expect(h.delMut.mutate).not.toHaveBeenCalled();
  });

  it("hides delete on an org-wide doc for a contributor but shows it for a manager", () => {
    h.docQ = { data: doc({ id: "org~secret", title: "Org Doc" }) };
    h.role = "contributor";
    const first = renderWithProviders(<Wiki />);
    expect(screen.getByTestId("wiki-edit-doc")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-delete-doc")).toBeNull();
    first.unmount();

    h.role = "manager";
    renderWithProviders(<Wiki />);
    expect(screen.getByTestId("wiki-delete-doc")).toBeInTheDocument();
  });

  it("toggles version history and restores a revision, toasting success", () => {
    h.role = "contributor";
    h.docQ = { data: doc() };
    renderWithProviders(<Wiki />);
    const toggle = screen.getByTestId("wiki-history-toggle");
    expect(screen.queryByTestId("doc-history")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId("doc-history")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("history-restore"));
    expect(h.saveMut.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Old Title", spaceId: "s1" }),
      expect.any(Object),
    );
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "REVISION RESTORED", description: "Old Title" }));
    // A successful restore closes the panel.
    expect(screen.queryByTestId("doc-history")).toBeNull();
  });

  it("closes the history panel via its close control", () => {
    h.docQ = { data: doc() };
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("wiki-history-toggle"));
    fireEvent.click(screen.getByTestId("history-close"));
    expect(screen.queryByTestId("doc-history")).toBeNull();
  });

  it("surfaces an error toast when a restore fails", () => {
    h.role = "contributor";
    h.docQ = { data: doc() };
    h.saveMut = { mutate: vi.fn((_i, opts) => opts?.onError?.(new Error("restore boom"))), isPending: false };
    renderWithProviders(<Wiki />);
    fireEvent.click(screen.getByTestId("wiki-history-toggle"));
    fireEvent.click(screen.getByTestId("history-restore"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "COULD NOT RESTORE", variant: "destructive" }));
    // The panel stays open when the restore fails.
    expect(screen.getByTestId("doc-history")).toBeInTheDocument();
  });
});
