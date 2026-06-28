import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { DevImpersonationControl } from "./DevImpersonationControl";

/**
 * The impersonation control renders only on a dev instance, requires a reason
 * before it will submit, and shows an accountable banner while active.
 */
function client(seed: Record<string, unknown>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  for (const [k, v] of Object.entries(seed)) qc.setQueryData([k], v);
  return qc;
}

describe("DevImpersonationControl", () => {
  it("renders nothing when not a dev instance", () => {
    const c = client({ "dev-mode": { devMode: false } });
    renderWithProviders(<DevImpersonationControl />, { client: c });
    expect(screen.queryByTestId("impersonate-open")).not.toBeInTheDocument();
  });

  it("offers the dialog on a dev instance and requires a reason to submit", () => {
    const c = client({ "dev-mode": { devMode: true }, "dev-impersonation": { impersonation: null } });
    renderWithProviders(<DevImpersonationControl />, { client: c });
    fireEvent.click(screen.getByTestId("impersonate-open"));
    const confirm = screen.getByTestId("impersonate-confirm");
    expect(confirm).toBeDisabled(); // no sub / no reason yet
    fireEvent.change(screen.getByLabelText(/User id/i), { target: { value: "jane.doe" } });
    expect(confirm).toBeDisabled(); // still needs a reason
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "reproduce the viewer bug" } });
    expect(confirm).toBeEnabled(); // sub + reason ⇒ approvable
  });

  it("shows an accountable banner (who + why + Stop) while impersonating", () => {
    const c = client({
      "dev-mode": { devMode: true },
      "dev-impersonation": { impersonation: { sub: "user-9", reason: "repro bug 42", by: "admin-1", expiresAt: Date.now() + 60000 } },
    });
    renderWithProviders(<DevImpersonationControl />, { client: c });
    const banner = screen.getByTestId("impersonation-banner");
    expect(banner).toHaveTextContent("user-9");
    expect(banner).toHaveTextContent("repro bug 42");
    expect(screen.getByTestId("impersonation-stop")).toBeInTheDocument();
  });
});
