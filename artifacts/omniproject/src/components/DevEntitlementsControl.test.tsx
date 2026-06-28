import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { DevEntitlementsControl } from "./DevEntitlementsControl";

/**
 * The entitlement control renders only on a dev instance and reflects the
 * effective grants with a "forced" marker when overridden.
 */
function client(seed: Record<string, unknown>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  for (const [k, v] of Object.entries(seed)) qc.setQueryData([k], v);
  return qc;
}

describe("DevEntitlementsControl", () => {
  it("renders nothing when not a dev instance", () => {
    const c = client({ "dev-mode": { devMode: false } });
    renderWithProviders(<DevEntitlementsControl />, { client: c });
    expect(screen.queryByTestId("entitlements-open")).not.toBeInTheDocument();
  });

  it("lists features and reflects effective grant + forced state on a dev instance", () => {
    const c = client({
      "dev-mode": { devMode: true },
      "dev-entitlements": { catalog: ["branding", "labels", "webhooks"], overrides: { branding: false }, effective: ["labels", "webhooks"] },
    });
    renderWithProviders(<DevEntitlementsControl />, { client: c });
    fireEvent.click(screen.getByTestId("entitlements-open"));
    // branding is revoked (overridden false) ⇒ checkbox unchecked
    expect(screen.getByTestId("entitlement-branding")).not.toBeChecked();
    // labels/webhooks granted ⇒ checked
    expect(screen.getByTestId("entitlement-labels")).toBeChecked();
    expect(screen.getByTestId("entitlement-webhooks")).toBeChecked();
    // the overridden one is marked
    expect(screen.getByTestId("entitlements-list")).toHaveTextContent("(forced)");
    expect(screen.getByTestId("entitlements-reset")).toBeInTheDocument();
  });
});
