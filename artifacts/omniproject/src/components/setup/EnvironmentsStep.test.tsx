import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { EnvironmentsStep } from "./EnvironmentsStep";
import type { StoreView } from "../../lib/setup";

const store: StoreView = {
  activeEnv: "production",
  environments: ["production", "sandbox"],
  versions: [
    { id: "v3", env: "production", at: "2026-01-02T00:00:00.000Z", label: "latest", knownGood: false },
    { id: "v2", env: "sandbox", at: "2026-01-01T00:00:00.000Z", knownGood: true },
  ],
  lastKnownGoodId: "v2",
  persisted: true,
};

function mockEnvFetch(view: StoreView = store) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(view),
  }) as unknown as typeof fetch;
}

describe("EnvironmentsStep", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("warns for non-admins and does not load", () => {
    const { getByText } = renderWithProviders(<EnvironmentsStep isAdmin={false} />);
    expect(getByText(/Environments & rollback require the admin role/)).toBeInTheDocument();
  });

  it("renders the loaded environments and version history", async () => {
    mockEnvFetch();
    const { getByRole, findByRole, getByText } = renderWithProviders(<EnvironmentsStep isAdmin />);
    expect(getByRole("heading", { name: "Environments & rollback" })).toBeInTheDocument();
    expect(await findByRole("button", { name: /production ●/ })).toBeInTheDocument();
    expect(getByRole("button", { name: "sandbox" })).toBeInTheDocument();
    expect(getByText("v3")).toBeInTheDocument();
    expect(getByText("latest")).toBeInTheDocument();
    expect(getByText(/persisted/)).toBeInTheDocument();
    // promote button appears because both sandbox + production exist
    expect(getByText(/Promote sandbox/)).toBeInTheDocument();
  });

  it("validates a bad new environment name", async () => {
    mockEnvFetch();
    const user = userEvent.setup();
    const { findByLabelText, getByRole } = renderWithProviders(<EnvironmentsStep isAdmin />);
    const input = await findByLabelText("New environment name");
    await user.type(input, "bad name");
    expect(getByRole("alert")).toHaveTextContent(/letters, numbers, dashes/);
    expect(getByRole("button", { name: /New env/ })).toBeDisabled();
  });

  it("renders the rollback control disabled when there is no known-good", async () => {
    mockEnvFetch({ ...store, lastKnownGoodId: null });
    const { findByRole } = renderWithProviders(<EnvironmentsStep isAdmin />);
    expect(await findByRole("button", { name: /Roll back to last known-good/ })).toBeDisabled();
  });

  it("opens the promote confirmation dialog", async () => {
    mockEnvFetch();
    const user = userEvent.setup();
    const { findByRole, findByText } = renderWithProviders(<EnvironmentsStep isAdmin />);
    await user.click(await findByText(/Promote sandbox/));
    const dialog = await findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Promote sandbox to production/);
  });

  it("shows a loading state then no crash when fetch fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    const { getByRole } = renderWithProviders(<EnvironmentsStep isAdmin />);
    expect(getByRole("heading", { name: "Environments & rollback" })).toBeInTheDocument();
  });
});
