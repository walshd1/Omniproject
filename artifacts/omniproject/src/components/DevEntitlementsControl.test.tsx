import { describe, it, expect, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../test/utils";
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

  it("closes the dialog when Done is clicked", async () => {
    const c = client({
      "dev-mode": { devMode: true },
      "dev-entitlements": { catalog: ["branding"], overrides: {}, effective: ["branding"] },
    });
    renderWithProviders(<DevEntitlementsControl />, { client: c });
    fireEvent.click(screen.getByTestId("entitlements-open"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

/**
 * The toggle/reset writes hit /api/dev-mode/entitlements (POST/DELETE) and then invalidate
 * the same query, forcing a real refetch — mockFetchRouter gives GET vs. POST/DELETE their
 * own canned response so the post-refetch UI state is asserted, not just the request itself.
 */
describe("DevEntitlementsControl — write actions", () => {
  afterEach(resetFetchMock);

  function seeded(): QueryClient {
    return client({
      "dev-mode": { devMode: true },
      "dev-entitlements": { catalog: ["branding", "labels"], overrides: {}, effective: ["labels"] },
    });
  }

  it("toggles a feature via its checkbox, POSTs the change, and reflects the refetched state", async () => {
    const calls = mockFetchRouter({
      "GET /api/dev-mode/entitlements": {
        ok: true,
        body: { catalog: ["branding", "labels"], overrides: { branding: true }, effective: ["branding", "labels"] },
      },
    });
    renderWithProviders(<DevEntitlementsControl />, { client: seeded() });
    fireEvent.click(screen.getByTestId("entitlements-open"));
    fireEvent.click(screen.getByTestId("entitlement-branding"));

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/dev-mode/entitlements") && c.init?.method === "POST");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call!.init!.body))).toEqual({ feature: "branding", enabled: true });
    });
    expect(await screen.findByTestId("entitlement-branding")).toBeChecked();
    expect(screen.getByTestId("entitlements-list")).toHaveTextContent("(forced)");
  });

  it("resets all overrides via the Reset button, DELETEs, and refetches", async () => {
    const calls = mockFetchRouter({
      "GET /api/dev-mode/entitlements": {
        ok: true,
        body: { catalog: ["branding", "labels"], overrides: {}, effective: ["branding", "labels"] },
      },
    });
    renderWithProviders(<DevEntitlementsControl />, { client: seeded() });
    fireEvent.click(screen.getByTestId("entitlements-open"));
    fireEvent.click(screen.getByTestId("entitlements-reset"));

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/dev-mode/entitlements") && c.init?.method === "DELETE");
      expect(call).toBeTruthy();
    });
    expect(await screen.findByTestId("entitlement-branding")).toBeChecked();
    expect(screen.queryByTestId("entitlements-list")).not.toHaveTextContent("(forced)");
  });
});
