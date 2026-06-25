import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/utils";
import { VerifyStep } from "./VerifyStep";
import type { SetupStatus } from "../../lib/setup";

const configured: SetupStatus = {
  configured: true,
  role: "admin",
  broker: { configured: true, urlSet: true },
  auth: { mode: "demo" },
  ai: { provider: "demo" },
  capabilities: null,
};

describe("VerifyStep", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the heading and run button", () => {
    const { getByRole } = renderWithProviders(<VerifyStep isAdmin status={configured} />);
    expect(getByRole("heading", { name: "Verify your workflow" })).toBeInTheDocument();
    expect(getByRole("button", { name: /Run verification/ })).toBeInTheDocument();
  });

  it("disables the button and warns when broker not configured", () => {
    const status: SetupStatus = { ...configured, broker: { configured: false, urlSet: false } };
    const { getByRole, getByText } = renderWithProviders(<VerifyStep isAdmin status={status} />);
    expect(getByRole("button", { name: /Run verification/ })).toBeDisabled();
    expect(getByText(/Connect n8n first/)).toBeInTheDocument();
  });

  it("disables the button for non-admins", () => {
    const { getByRole } = renderWithProviders(<VerifyStep isAdmin={false} status={configured} />);
    expect(getByRole("button", { name: /Run verification/ })).toBeDisabled();
  });

  it("renders verify results after running", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          webhookUrl: "https://n8n/op",
          summary: { passed: 1, total: 2, verifyAware: true },
          results: [
            { action: "list_issues", ok: true, status: 200, ms: 12, verifyAware: true, message: null },
            { action: "list_resources", ok: false, status: 500, ms: 30, verifyAware: true, message: "err" },
          ],
          note: "Probe complete.",
        }),
    }) as unknown as typeof fetch;

    const { getByRole, findByText, getByText } = renderWithProviders(<VerifyStep isAdmin status={configured} />);
    await user.click(getByRole("button", { name: /Run verification/ }));
    expect(await findByText("1/2 actions responding")).toBeInTheDocument();
    expect(getByText("list_issues")).toBeInTheDocument();
    expect(getByText("list_resources")).toBeInTheDocument();
    expect(getByText("Probe complete.")).toBeInTheDocument();
    expect(getByText(/verify-aware/)).toBeInTheDocument();
  });
});
