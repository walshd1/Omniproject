import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, mockReload } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { BrandingAdmin } from "./BrandingAdmin";

/**
 * White-label branding panel: the entitlement gate, the form fields (blanking the
 * product's own defaults so a placeholder shows instead of a stale "current value"),
 * and the two write flows (save, reset-with-confirm) — none of this had a test file
 * at all before, only incidental render coverage via PremiumAdmin.test.tsx.
 */
function seeded(branding: Record<string, unknown> = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["branding", "admin"], branding);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("BrandingAdmin", () => {
  it("shows a lock notice and disables the form when not entitled", () => {
    renderWithProviders(<BrandingAdmin entitled={false} />, { client: seeded() });
    expect(screen.getByText(/Licensed feature/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("OmniProject")).toBeDisabled();
  });

  it("hides the lock notice and enables the form when entitled", () => {
    renderWithProviders(<BrandingAdmin entitled />, { client: seeded() });
    expect(screen.queryByText(/Licensed feature/i)).toBeNull();
    expect(screen.getByPlaceholderText("OmniProject")).toBeEnabled();
  });

  it("renders a blank form while branding data is still loading (no cached query data yet)", () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // No qc.setQueryData — the query hasn't resolved yet, so `data` is undefined on mount.
    renderWithProviders(<BrandingAdmin entitled />, { client: qc });
    expect(screen.getByPlaceholderText("OmniProject")).toHaveValue("");
  });

  it("blanks the product's own defaults so the placeholder shows, but keeps a real custom value", () => {
    renderWithProviders(<BrandingAdmin entitled />, {
      client: seeded({
        appName: "OmniProject", // product default → blanked
        shortName: "OP", // product default → blanked
        loginHeading: "Orchestration Shell", // product default → blanked
        footerText: "© Acme Corp", // real custom value → kept
      }),
    });
    expect(screen.getByPlaceholderText("OmniProject")).toHaveValue("");
    expect(screen.getByPlaceholderText("OP")).toHaveValue("");
    expect(screen.getByPlaceholderText("Orchestration Shell")).toHaveValue("");
    expect(screen.getByDisplayValue("© Acme Corp")).toBeInTheDocument();
  });

  it("saves the edited form, toasts, and reloads the page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const reload = mockReload();
      const calls = mockFetchRouter({});
      renderWithProviders(<><BrandingAdmin entitled /><Toaster /></>, { client: seeded() });

      fireEvent.change(screen.getByPlaceholderText("OmniProject"), { target: { value: "Acme PMO" } });
      fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

      await vi.waitFor(() => expect(screen.getByText("BRANDING SAVED")).toBeInTheDocument());
      const putCall = calls.find((c) => c.init?.method === "PUT");
      expect(putCall).toBeTruthy();
      expect(JSON.parse(String(putCall!.init!.body))).toMatchObject({ appName: "Acme PMO" });

      await vi.advanceTimersByTimeAsync(800);
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an error toast and never reloads when saving fails", async () => {
    const reload = mockReload();
    mockFetchRouter({ "/api/branding": { ok: false, status: 500, body: { error: "Storage unavailable" } } });
    renderWithProviders(<><BrandingAdmin entitled /><Toaster /></>, { client: seeded() });

    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Storage unavailable")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("falls back to an HTTP status message when the failure response has no error field", async () => {
    mockFetchRouter({ "/api/branding": { ok: false, status: 503, body: {} } });
    renderWithProviders(<><BrandingAdmin entitled /><Toaster /></>, { client: seeded() });

    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    // Assert on the status text alone (unique to this toast) rather than also checking the
    // "ERROR" title: the toast singleton (use-toast.ts's memoryState) persists across tests in
    // this file, so an earlier "ERROR"-titled toast can still be in the DOM when this test's
    // component mounts, and asserting on the shared title first is a false-positive race.
    expect(await screen.findByText("HTTP 503")).toBeInTheDocument();
  });

  it("falls back to an HTTP status message when the failure response body isn't valid JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    }) as unknown as typeof fetch;
    renderWithProviders(<><BrandingAdmin entitled /><Toaster /></>, { client: seeded() });

    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    expect(await screen.findByText("HTTP 500")).toBeInTheDocument();
  });

  it("stringifies a non-Error thrown value directly in the error toast", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue("network down") as unknown as typeof fetch;
    renderWithProviders(<><BrandingAdmin entitled /><Toaster /></>, { client: seeded() });

    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    expect(await screen.findByText("network down")).toBeInTheDocument();
  });

  it("resets branding to default after confirming, DELETEs, toasts, and reloads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const reload = mockReload();
      const calls = mockFetchRouter({});
      renderWithProviders(<><BrandingAdmin entitled /><Toaster /></>, { client: seeded({ appName: "Acme PMO" }) });

      fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));
      // The confirm dialog opens synchronously — screen.findByText's internal waitFor
      // relies on real timers, which hang while fake timers are active (see LabelsAdmin's
      // save-flow test for the same pattern), so assert synchronously instead.
      expect(screen.getByText("Reset branding to default?")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /reset & reload/i }));

      await vi.waitFor(() => expect(screen.getByText("BRANDING CLEARED")).toBeInTheDocument());
      expect(calls.find((c) => c.init?.method === "DELETE" && c.url.endsWith("/api/branding"))).toBeTruthy();

      await vi.advanceTimersByTimeAsync(800);
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelling the reset confirmation sends no request", async () => {
    const calls = mockFetchRouter({});
    renderWithProviders(<BrandingAdmin entitled />, { client: seeded() });

    fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));
    expect(await screen.findByText("Reset branding to default?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Reset branding to default?")).not.toBeInTheDocument());
    expect(calls.find((c) => c.init?.method === "DELETE")).toBeUndefined();
  });
});
