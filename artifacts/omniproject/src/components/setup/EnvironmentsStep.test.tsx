import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { Toaster } from "../ui/toaster";
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

/**
 * Every lib/setup.ts action (create/activate/promote/markKnownGood/rollback) POSTs through the
 * same postJson helper, and createEnvironment/activateEnvironment even share a path with the
 * initial GET (POST vs GET /api/setup/environments) — so routing must key on METHOD + pathname,
 * not pathname alone. `overrides` lets a test give a specific "METHOD /path" a distinct response
 * (e.g. rollback's `{rolledBack, appliedVersion, store}` envelope, which differs from the plain
 * StoreView every other action returns); anything not overridden falls back to `view`, matching
 * every pre-existing call site's positional `mockEnvFetch(someStore)` usage.
 */
function mockEnvFetch(view: StoreView = store, overrides: Record<string, { ok?: boolean; body: unknown }> = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    const path = new URL(href, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const route = overrides[`${method} ${path}`];
    return {
      ok: route?.ok ?? true,
      status: route?.ok === false ? 500 : 200,
      json: () => Promise.resolve(route ? route.body : view),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
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

  it("retries loading after a fetch error", async () => {
    // A plain sequential mockRejectedValueOnce/mockResolvedValueOnce is unreliable here: fetch is
    // shared by the whole render tree (renderWithProviders also mounts BrandingProvider, which
    // fetches its own config), so any OTHER caller's fetch would silently consume a queued slot
    // meant for this component's own two calls. Scope the one-shot failure to this endpoint's URL.
    let failedOnce = false;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url), "http://localhost").pathname;
      if (path === "/api/setup/environments" && !failedOnce) {
        failedOnce = true;
        throw new Error("boom");
      }
      return { ok: true, status: 200, json: () => Promise.resolve(store) } as unknown as Response;
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    const { findByRole } = renderWithProviders(<EnvironmentsStep isAdmin />);
    await user.click(await findByRole("button", { name: /retry/i }));
    expect(await findByRole("button", { name: /production ●/ })).toBeInTheDocument();
  });

  it("hides the promote button when both sandbox and production aren't present", async () => {
    mockEnvFetch({ ...store, environments: ["production"] });
    const { findByRole, queryByText } = renderWithProviders(<EnvironmentsStep isAdmin />);
    await findByRole("button", { name: /production ●/ });
    expect(queryByText(/Promote sandbox/)).toBeNull();
  });

  it("switches the active environment and toasts, but does nothing for the already-active one", async () => {
    const calls = mockEnvFetch();
    const user = userEvent.setup();
    const { findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);

    await user.click(await findByRole("button", { name: "sandbox" }));
    expect(await findByText("SWITCHED TO SANDBOX")).toBeInTheDocument();
    const activateCall = calls.find((c) => c.init?.method === "POST" && c.url.includes("/activate"));
    expect(JSON.parse(String(activateCall!.init!.body))).toEqual({ name: "sandbox" });

    const before = calls.length;
    await user.click(screen.getByTitle("Active environment"));
    expect(calls.length).toBe(before); // clicking the already-active env fires no request
  });

  it("creates a new environment, toasts, and resets the input", async () => {
    const calls = mockEnvFetch();
    const user = userEvent.setup();
    const { findByLabelText, findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);

    const input = await findByLabelText("New environment name");
    await user.type(input, "staging");
    await user.click(await findByRole("button", { name: /New env/ }));

    expect(await findByText("CREATED STAGING")).toBeInTheDocument();
    expect(input).toHaveValue("");
    const createCall = calls.find((c) => c.init?.method === "POST" && c.url.endsWith("/api/setup/environments"));
    expect(JSON.parse(String(createCall!.init!.body))).toEqual({ name: "staging" });
  });

  it("shows a 'couldn't do that' error toast when an environment action fails", async () => {
    mockEnvFetch(store, { "POST /api/setup/environments/activate": { ok: false, body: { error: "locked" } } });
    const user = userEvent.setup();
    const { findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    await user.click(await findByRole("button", { name: "sandbox" }));
    expect(await findByText("Couldn't do that")).toBeInTheDocument();
    expect(await findByText("locked")).toBeInTheDocument();
  });

  it("confirms the promote dialog, promoting sandbox to production", async () => {
    const calls = mockEnvFetch();
    const user = userEvent.setup();
    const { findByText, findByRole } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    await user.click(await findByText(/Promote sandbox/));
    await user.click(await findByRole("button", { name: "Promote to production" }));
    expect(await findByText("PROMOTED SANDBOX → PRODUCTION")).toBeInTheDocument();
    expect(calls.find((c) => c.init?.method === "POST" && c.url.endsWith("/api/setup/promote"))).toBeTruthy();
  });

  it("confirms rollback to last known-good, toasting the applied version", async () => {
    mockEnvFetch(store, {
      "POST /api/setup/rollback": { body: { rolledBack: true, appliedVersion: "v2", store } },
    });
    const user = userEvent.setup();
    const { findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    await user.click(await findByRole("button", { name: /Roll back to last known-good/ }));
    await user.click(await findByRole("button", { name: "Roll back" }));
    expect(await findByText("Rolled back")).toBeInTheDocument();
    expect(await findByText("Restored config version v2.")).toBeInTheDocument();
  });

  it("shows a 'couldn't roll back' error toast when rollback fails", async () => {
    mockEnvFetch(store, { "POST /api/setup/rollback": { ok: false, body: { error: "no snapshot" } } });
    const user = userEvent.setup();
    const { findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    await user.click(await findByRole("button", { name: /Roll back to last known-good/ }));
    await user.click(await findByRole("button", { name: "Roll back" }));
    expect(await findByText("Couldn't roll back")).toBeInTheDocument();
    expect(await findByText("no snapshot")).toBeInTheDocument();
  });

  it("pins a version as known-good", async () => {
    const calls = mockEnvFetch();
    const user = userEvent.setup();
    const { findAllByTitle, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    const [firstStar] = await findAllByTitle("Pin as known-good"); // one per version in store.versions
    await user.click(firstStar!);
    expect(await findByText("PINNED KNOWN-GOOD")).toBeInTheDocument();
    expect(calls.find((c) => c.init?.method === "POST" && c.url.includes("/known-good"))).toBeTruthy();
  });

  it("confirms rollback to a specific version", async () => {
    mockEnvFetch(store, {
      "POST /api/setup/rollback": { body: { rolledBack: true, appliedVersion: "v3", store } },
    });
    const user = userEvent.setup();
    const { findAllByTitle, findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    const [firstRollbackTrigger] = await findAllByTitle("Roll back to this version");
    await user.click(firstRollbackTrigger!);
    await user.click(await findByRole("button", { name: "Roll back" }));
    expect(await findByText("Restored config version v3.")).toBeInTheDocument();
  });

  it("styles a non-production active environment distinctly from an inactive one", async () => {
    mockEnvFetch({ ...store, activeEnv: "sandbox" });
    const { findByRole } = renderWithProviders(<EnvironmentsStep isAdmin />);
    expect(await findByRole("button", { name: /sandbox ●/ })).toHaveClass("border-primary");
  });

  it("labels version history as in-memory when the store isn't persisted", async () => {
    mockEnvFetch({ ...store, persisted: false });
    const { findByText } = renderWithProviders(<EnvironmentsStep isAdmin />);
    expect(await findByText(/in-memory/)).toBeInTheDocument();
  });

  it("clicking New env with a blank name does nothing", async () => {
    const calls = mockEnvFetch();
    const user = userEvent.setup();
    const { findByRole } = renderWithProviders(<EnvironmentsStep isAdmin />);
    await user.click(await findByRole("button", { name: /New env/ }));
    expect(calls.find((c) => c.init?.method === "POST")).toBeUndefined();
  });

  it("leaves the draft name in place when creating a new environment fails", async () => {
    mockEnvFetch(store, { "POST /api/setup/environments": { ok: false, body: { error: "taken" } } });
    const user = userEvent.setup();
    const { findByLabelText, findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    const input = await findByLabelText("New environment name");
    await user.type(input, "staging");
    await user.click(await findByRole("button", { name: /New env/ }));
    expect(await findByText("taken")).toBeInTheDocument();
    expect(input).toHaveValue("staging");
  });

  it("falls back to a generic 'failed' message when an action throws something other than an Error", async () => {
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const path = new URL(String(url), "http://localhost").pathname;
      if (path === "/api/setup/environments/activate") return Promise.reject("not an Error instance");
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(store) } as unknown as Response);
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    const { findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    await user.click(await findByRole("button", { name: "sandbox" }));
    expect(await findByText("Couldn't do that")).toBeInTheDocument();
    expect(await findByText("failed")).toBeInTheDocument();
  });

  it("falls back to a generic 'failed' message when rollback throws something other than an Error", async () => {
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const path = new URL(String(url), "http://localhost").pathname;
      if (path === "/api/setup/rollback") return Promise.reject("not an Error instance");
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(store) } as unknown as Response);
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    const { findByRole, findByText } = renderWithProviders(<><EnvironmentsStep isAdmin /><Toaster /></>);
    await user.click(await findByRole("button", { name: /Roll back to last known-good/ }));
    await user.click(await findByRole("button", { name: "Roll back" }));
    expect(await findByText("Couldn't roll back")).toBeInTheDocument();
    expect(await findByText("failed")).toBeInTheDocument();
  });
});
