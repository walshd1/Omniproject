import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
