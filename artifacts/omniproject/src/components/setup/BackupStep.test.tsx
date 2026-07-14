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
});
