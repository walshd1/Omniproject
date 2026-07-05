import { describe, it, expect, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchRouter, resetFetchMock, mockReload } from "../test/utils";
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

/** Opens the dialog and fills in the two required fields (sub + reason), leaving it ready to submit. */
function openAndFill(sub = "jane.doe", reason = "reproduce the viewer bug") {
  fireEvent.click(screen.getByTestId("impersonate-open"));
  fireEvent.change(screen.getByLabelText(/User id/i), { target: { value: sub } });
  fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: reason } });
}

describe("DevImpersonationControl", () => {
  afterEach(resetFetchMock);

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

  it("submits trimmed fields, omitting blank email/role, then reloads", async () => {
    const reload = mockReload();
    const calls = mockFetchRouter({
      "POST /api/dev-mode/impersonate": { ok: true, body: {} },
      "GET /api/dev-mode/impersonate": { ok: true, body: { impersonation: null } },
    });
    const c = client({ "dev-mode": { devMode: true }, "dev-impersonation": { impersonation: null } });
    renderWithProviders(<DevImpersonationControl />, { client: c });

    openAndFill("  jane.doe  ", "  reproduce the viewer bug  ");
    fireEvent.click(screen.getByTestId("impersonate-confirm"));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    const post = calls.find((call) => call.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toEqual({ sub: "jane.doe", reason: "reproduce the viewer bug" });
    expect(screen.queryByTestId("impersonate-confirm")).not.toBeInTheDocument(); // dialog closed
  });

  it("includes trimmed email and a single-element roles array when provided", async () => {
    mockReload();
    const calls = mockFetchRouter({
      "POST /api/dev-mode/impersonate": { ok: true, body: {} },
      "GET /api/dev-mode/impersonate": { ok: true, body: { impersonation: null } },
    });
    const c = client({ "dev-mode": { devMode: true }, "dev-impersonation": { impersonation: null } });
    renderWithProviders(<DevImpersonationControl />, { client: c });

    openAndFill();
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: " jane@example.com " } });
    fireEvent.change(screen.getByLabelText(/Role claim/i), { target: { value: " viewer " } });
    fireEvent.click(screen.getByTestId("impersonate-confirm"));

    await waitFor(() => expect(calls.some((call) => call.init?.method === "POST")).toBe(true));
    const post = calls.find((call) => call.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toEqual({
      sub: "jane.doe",
      email: "jane@example.com",
      roles: ["viewer"],
      reason: "reproduce the viewer bug",
    });
  });

  it("shows the server's error message and keeps the dialog open when starting fails", async () => {
    mockFetchRouter({ "POST /api/dev-mode/impersonate": { ok: false, status: 403, body: { error: "sub not allowed" } } });
    const c = client({ "dev-mode": { devMode: true }, "dev-impersonation": { impersonation: null } });
    renderWithProviders(<DevImpersonationControl />, { client: c });

    openAndFill();
    fireEvent.click(screen.getByTestId("impersonate-confirm"));

    expect(await screen.findByRole("alert")).toHaveTextContent("sub not allowed");
    expect(screen.getByTestId("impersonate-confirm")).toBeInTheDocument(); // dialog still open
  });

  it("falls back to a default error message when the failure response has no error field", async () => {
    mockFetchRouter({ "POST /api/dev-mode/impersonate": { ok: false, status: 500, body: {} } });
    const c = client({ "dev-mode": { devMode: true }, "dev-impersonation": { impersonation: null } });
    renderWithProviders(<DevImpersonationControl />, { client: c });

    openAndFill();
    fireEvent.click(screen.getByTestId("impersonate-confirm"));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not start impersonation");
  });

  it("falls back to a default error message when the failure response body isn't valid JSON", async () => {
    globalThis.fetch = (async () => ({ ok: false, json: () => Promise.reject(new Error("bad json")) })) as unknown as typeof fetch;
    const c = client({ "dev-mode": { devMode: true }, "dev-impersonation": { impersonation: null } });
    renderWithProviders(<DevImpersonationControl />, { client: c });

    openAndFill();
    fireEvent.click(screen.getByTestId("impersonate-confirm"));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not start impersonation");
  });

  it("fetches the dev-mode status from the network when not pre-seeded", async () => {
    mockFetchRouter({ "GET /api/dev-mode": { ok: true, body: { devMode: true } } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithProviders(<DevImpersonationControl />, { client: qc });
    expect(await screen.findByTestId("impersonate-open")).toBeInTheDocument();
  });

  it("cancelling the dialog doesn't submit anything", () => {
    const calls = mockFetchRouter({});
    const c = client({ "dev-mode": { devMode: true }, "dev-impersonation": { impersonation: null } });
    renderWithProviders(<DevImpersonationControl />, { client: c });

    openAndFill();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByTestId("impersonate-confirm")).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/api/dev-mode/impersonate"))).toBe(false);
  });

  it("stops an impersonation and reloads", async () => {
    const reload = mockReload();
    const calls = mockFetchRouter({
      "DELETE /api/dev-mode/impersonate": { ok: true, body: {} },
      "GET /api/dev-mode/impersonate": { ok: true, body: { impersonation: null } },
    });
    const c = client({
      "dev-mode": { devMode: true },
      "dev-impersonation": { impersonation: { sub: "user-9", reason: "repro bug 42", by: "admin-1", expiresAt: Date.now() + 60000 } },
    });
    renderWithProviders(<DevImpersonationControl />, { client: c });

    fireEvent.click(screen.getByTestId("impersonation-stop"));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(calls.some((call) => call.init?.method === "DELETE")).toBe(true);
  });
});
