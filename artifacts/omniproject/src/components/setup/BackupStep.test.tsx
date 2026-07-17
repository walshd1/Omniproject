import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { BackupStep } from "./BackupStep";
import type { SetupStatus } from "../../lib/setup";

const status: SetupStatus = {
  configured: true,
  role: "admin",
  broker: { configured: true, urlSet: true },
  auth: { mode: "demo" },
  ai: { provider: "demo" },
  capabilities: null,
};

function snapshotFile(content: string, name = "snap.json"): File {
  const file = new File([content], name, { type: "application/json" });
  // jsdom's Blob.text() is unreliable here; provide a deterministic reader.
  Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
  return file;
}

describe("BackupStep", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the heading and admin actions", () => {
    const { getByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    expect(getByRole("heading", { name: "Backup & restore" })).toBeInTheDocument();
    expect(getByRole("button", { name: /Download backup/ })).toBeEnabled();
  });

  it("warns and disables download for non-admins", () => {
    const { getByText, getByRole } = renderWithProviders(<BackupStep isAdmin={false} status={status} />);
    expect(getByText(/Backup & restore require the admin role/)).toBeInTheDocument();
    expect(getByRole("button", { name: /Download backup/ })).toBeDisabled();
  });

  it("shows the debug bundle button when stateful demo is on", () => {
    const devStatus: SetupStatus = { ...status, dev: { statefulDemo: true } };
    const { getByRole, getByText } = renderWithProviders(<BackupStep isAdmin status={devStatus} />);
    expect(getByText(/Stateful developer mode is ON/)).toBeInTheDocument();
    expect(getByRole("button", { name: /Download debug bundle/ })).toBeInTheDocument();
  });

  it("opens a confirmation dialog for a valid snapshot file", async () => {
    const user = userEvent.setup();
    const { container, findByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const valid = JSON.stringify({ schema: "omniproject/config-snapshot", settings: { brokerUrl: "x" } });
    await user.upload(input, snapshotFile(valid));
    const dialog = await findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Restore config from snapshot/);
    expect(dialog).toHaveTextContent("snap.json");
  });

  it("rejects a structurally invalid snapshot without opening the dialog", async () => {
    const user = userEvent.setup();
    const { container, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const wrong = JSON.stringify({ schema: "something-else", settings: {} });
    await user.upload(input, snapshotFile(wrong));
    expect(queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("applies the restore after confirmation", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ restored: true }),
    });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    const user = userEvent.setup();
    const { container, findByRole, getByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const valid = JSON.stringify({ schema: "omniproject/config-snapshot", settings: { brokerUrl: "x" } });
    await user.upload(input, snapshotFile(valid));
    await findByRole("alertdialog");
    await user.click(getByRole("button", { name: "Restore config" }));
    expect(fetchFn).toHaveBeenCalledWith("/api/setup/restore", expect.objectContaining({ method: "POST" }));
  });

  it("logs a warning and still closes the dialog when the restore returns warnings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ restored: true, warnings: ["ignored: unknown key"] }) }) as unknown as typeof fetch;
    const user = userEvent.setup();
    const { container, findByRole, getByRole, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, snapshotFile(JSON.stringify({ schema: "omniproject/config-snapshot", settings: {} })));
    await findByRole("alertdialog");
    await user.click(getByRole("button", { name: "Restore config" }));
    expect(warn).toHaveBeenCalledWith("Restore warnings:", ["ignored: unknown key"]);
    expect(queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("closes the dialog without restoring when the restore request fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: "bad snapshot" }) });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    const user = userEvent.setup();
    const { container, findByRole, getByRole, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, snapshotFile(JSON.stringify({ schema: "omniproject/config-snapshot", settings: {} })));
    await findByRole("alertdialog");
    await user.click(getByRole("button", { name: "Restore config" }));
    expect(fetchFn).toHaveBeenCalledWith("/api/setup/restore", expect.objectContaining({ method: "POST" }));
    // The catch path runs (a destructive-restore error toast) and the dialog is dismissed.
    await waitFor(() => expect(queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("rejects a snapshot that is a JSON array (not an object)", async () => {
    const user = userEvent.setup();
    const { container, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, snapshotFile("[1,2,3]"));
    expect(queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("rejects a snapshot missing its settings object", async () => {
    const user = userEvent.setup();
    const { container, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, snapshotFile(JSON.stringify({ schema: "omniproject/config-snapshot" })));
    expect(queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("rejects a non-JSON file without opening the dialog", async () => {
    const user = userEvent.setup();
    const { container, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // safeParseJson throws on this → the JSON.parse guard toasts and returns early.
    await user.upload(input, snapshotFile("<<<not json>>>"));
    expect(queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancelling the restore dialog dismisses it and clears the file input", async () => {
    const user = userEvent.setup();
    const { container, findByRole, getByRole, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, snapshotFile(JSON.stringify({ schema: "omniproject/config-snapshot", settings: {} })));
    await findByRole("alertdialog");
    await user.click(getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(input.value).toBe("");
  });

  it("downloads the debug bundle via an anchor when stateful demo is on", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      const devStatus: SetupStatus = { ...status, dev: { statefulDemo: true } };
      const { getByRole } = renderWithProviders(<BackupStep isAdmin status={devStatus} />);
      await user.click(getByRole("button", { name: /Download debug bundle/ }));
      expect(click).toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  });

  it("surfaces a download error (and never triggers a file download) when the snapshot fetch fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, blob: () => Promise.resolve(new Blob()) }) as unknown as typeof fetch;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const { getByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
      await user.click(getByRole("button", { name: /Download backup/ }));
      // downloadSnapshot rejects on the non-ok response → the .catch toast fires and no anchor is clicked.
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/setup/snapshot", expect.anything()));
      expect(click).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  });

  // ── Definitions backup (roadmap X.14) ──────────────────────────────────────────────────────────────────
  const defsFileInput = (container: HTMLElement) => container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
  const defsBundle = (extra: object = {}) => JSON.stringify({ schema: "omniproject/def-store-export", version: 1, collections: [], ...extra });

  it("renders the definitions-backup actions for an admin", () => {
    const { getByRole, getByText } = renderWithProviders(<BackupStep isAdmin status={status} />);
    expect(getByText(/Definitions backup/)).toBeInTheDocument();
    expect(getByRole("button", { name: /Download defs backup/ })).toBeInTheDocument();
    expect(getByText(/system.*never exported/i)).toBeInTheDocument();
  });

  it("opens the definitions confirm dialog for a valid def-store file", async () => {
    const user = userEvent.setup();
    const { container, findByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    await user.upload(defsFileInput(container), snapshotFile(defsBundle(), "defs.json"));
    const dialog = await findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Restore definitions from backup/);
    expect(dialog).toHaveTextContent("defs.json");
  });

  it("rejects a def-store file with the wrong schema", async () => {
    const user = userEvent.setup();
    const { container, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    await user.upload(defsFileInput(container), snapshotFile(JSON.stringify({ schema: "nope", collections: [] })));
    expect(queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("POSTs defs-import on confirmation", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ imported: true, written: [{ type: "def", count: 1 }] }) });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    const user = userEvent.setup();
    const { container, findByRole, getByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    await user.upload(defsFileInput(container), snapshotFile(defsBundle()));
    await findByRole("alertdialog");
    await user.click(getByRole("button", { name: "Restore definitions" }));
    expect(fetchFn).toHaveBeenCalledWith("/api/setup/defs-import", expect.objectContaining({ method: "POST" }));
  });

  // ── Full backup (settings + defs) ──────────────────────────────────────────────────────────────────────
  const fullFileInput = (container: HTMLElement) => container.querySelectorAll('input[type="file"]')[2] as HTMLInputElement;
  const fullBundle = () => JSON.stringify({ schema: "omniproject/full-backup", version: 1, settings: { schema: "omniproject/config-snapshot", settings: {} }, defStore: { schema: "omniproject/def-store-export", collections: [] } });

  it("renders the full-backup actions for an admin", () => {
    const { getByRole, getByText } = renderWithProviders(<BackupStep isAdmin status={status} />);
    expect(getByText(/Full backup \(settings \+ defs\)/)).toBeInTheDocument();
    expect(getByRole("button", { name: /Download full backup/ })).toBeInTheDocument();
  });

  it("opens the full-restore confirm dialog and POSTs full-restore", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ restored: true, settingsRestored: true, defStore: { written: [{}] } }) });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    const user = userEvent.setup();
    const { container, findByRole, getByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    await user.upload(fullFileInput(container), snapshotFile(fullBundle(), "full.json"));
    const dialog = await findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Restore the FULL backup/);
    await user.click(getByRole("button", { name: "Restore everything" }));
    expect(fetchFn).toHaveBeenCalledWith("/api/setup/full-restore", expect.objectContaining({ method: "POST" }));
  });

  it("rejects a full-backup file with the wrong schema", async () => {
    const user = userEvent.setup();
    const { container, queryByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    await user.upload(fullFileInput(container), snapshotFile(JSON.stringify({ schema: "nope" })));
    expect(queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("downloads the ENCRYPTED backup from the ?encrypted=1 endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["{}"])) });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const user = userEvent.setup();
    const { getByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    await user.click(getByRole("button", { name: /Download encrypted backup/ }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith("/api/setup/full-backup?encrypted=1", expect.anything()));
  });

  it("compares an uploaded backup against live and renders the content-free diff", async () => {
    const diffResult = {
      schema: "omniproject/config-diff", generatedAt: "t", identical: false,
      settings: { added: ["priorityLabels"], removed: [], changed: [{ key: "reportingCurrency", status: "changed", secret: false }, { key: "priorityLabels", status: "added", secret: false }], unchanged: 3 },
      defStore: [{ type: "def", scopeLabel: "org", added: 1, removed: 0, changed: 1, items: [{ id: "d-new", status: "added", fromRowVersion: null, toRowVersion: 1 }, { id: "d-bump", status: "changed", fromRowVersion: 1, toRowVersion: 2 }] }],
      extraStores: [], summary: { settingsAdded: 1, settingsRemoved: 0, settingsChanged: 1, defsAdded: 1, defsRemoved: 0, defsChanged: 1, collectionsChanged: 1 },
    };
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(diffResult) });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    const user = userEvent.setup();
    const { container, findByTestId } = renderWithProviders(<BackupStep isAdmin status={status} />);
    // the compare input is the 4th file input (snapshot, defs, full-restore, compare)
    const compareInput = container.querySelectorAll('input[type="file"]')[3] as HTMLInputElement;
    await user.upload(compareInput, snapshotFile(fullBundle(), "other.json"));
    const panel = await findByTestId("config-diff-result");
    expect(fetchFn).toHaveBeenCalledWith("/api/setup/config-diff", expect.objectContaining({ method: "POST" }));
    expect(panel).toHaveTextContent("reportingCurrency");
    expect(panel).toHaveTextContent("d-bump");
    expect(panel).toHaveTextContent("v1→2");
  });

  it("accepts a SEALED backup file for restore (encrypted schema)", async () => {
    const sealed = JSON.stringify({ schema: "omniproject/full-backup-sealed", version: 1, createdAt: "t", keyFingerprint: "fp", sealed: "c2.1.abc" });
    const user = userEvent.setup();
    const { container, findByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
    await user.upload(fullFileInput(container), snapshotFile(sealed, "sealed.json"));
    expect(await findByRole("alertdialog")).toHaveTextContent(/Restore the FULL backup/);
  });

  it("does not download when the export needs a fresh step-up (403 step_up_required)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: "recent re-authentication required", code: "step_up_required" }) });
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      const { getByRole } = renderWithProviders(<BackupStep isAdmin status={status} />);
      await user.click(getByRole("button", { name: /Download defs backup/ }));
      // downloadDefsExport rejects with Error("step_up_required") → the .catch shows the step-up hint, no anchor click.
      await waitFor(() => expect(fetchFn).toHaveBeenCalledWith("/api/setup/defs-export", expect.anything()));
      expect(click).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  });
});
