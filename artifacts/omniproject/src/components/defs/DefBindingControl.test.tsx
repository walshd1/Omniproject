import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import type { Role } from "../../lib/auth";
import { DefBindingControl } from "./DefBindingControl";

/**
 * DefBindingControl (roadmap X.12 slice 4) — the select-a-def-and-optionally-lock control. It shows the
 * server-resolved winner, offers scope-appropriate targets, and PUTs the selection; a lock is offered only
 * above `user`, and a step-up refusal is surfaced (not swallowed).
 */
afterEach(() => resetFetchMock());

function seed(role: Role): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  return qc;
}

const RESOLVED = [
  { id: "user~mine", kind: "screen", name: "My screen", storage: "user", createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1, payload: {} },
  { id: "org~std", kind: "screen", name: "Org screen", storage: "org", createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1, payload: {} },
];

describe("DefBindingControl", () => {
  it("shows the server-resolved winner for the slot", async () => {
    mockFetchRouter({
      "/api/defs/resolved/screen": { ok: true, body: RESOLVED },
      "/api/defs/active": { ok: true, body: { projects: { defId: "org~std", locked: true, lockedBy: "org", source: "org" } } },
    });
    renderWithProviders(<DefBindingControl slot="projects" kind="screen" projectId="p1" />, { client: seed("admin") });
    await waitFor(() => {
      const active = screen.getByTestId("def-binding-active-projects");
      expect(active.textContent).toContain("org~std");
      expect(active.textContent).toContain("locked by org");
    });
  });

  it("a contributor gets only the 'Just me' scope and NO lock option", async () => {
    mockFetchRouter({
      "/api/defs/resolved/screen": { ok: true, body: RESOLVED },
      "/api/defs/active": { ok: true, body: {} },
    });
    renderWithProviders(<DefBindingControl slot="projects" kind="screen" projectId="p1" />, { client: seed("contributor") });
    const scopeSel = await screen.findByTestId("def-binding-scope-projects");
    expect(scopeSel.querySelectorAll("option")).toHaveLength(1); // just "user"
    expect(screen.queryByTestId("def-binding-lock-projects")).toBeNull();
  });

  it("PUTs the chosen selection at the chosen scope", async () => {
    const calls = mockFetchRouter({
      "/api/defs/resolved/screen": { ok: true, body: RESOLVED },
      "/api/defs/active": { ok: true, body: {} },
      "PUT /api/defs/bindings": { ok: true, body: { scope: "org", bindings: {} } },
    });
    renderWithProviders(<DefBindingControl slot="projects" kind="screen" projectId="p1" />, { client: seed("admin") });
    fireEvent.change(await screen.findByTestId("def-binding-scope-projects"), { target: { value: "org" } });
    fireEvent.change(screen.getByTestId("def-binding-def-projects"), { target: { value: "org~std" } });
    fireEvent.click(screen.getByTestId("def-binding-lock-projects"));
    fireEvent.click(screen.getByTestId("def-binding-save-projects"));
    await waitFor(() => {
      const put = calls.find((c) => c.url.includes("/api/defs/bindings") && (c.init?.method ?? "GET") === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put!.init!.body));
      expect(body).toMatchObject({ scope: "org", slot: "projects", defId: "org~std", locked: true });
    });
  });

  it("surfaces a step-up refusal when locking without a fresh step-up", async () => {
    mockFetchRouter({
      "/api/defs/resolved/screen": { ok: true, body: RESOLVED },
      "/api/defs/active": { ok: true, body: {} },
      "PUT /api/defs/bindings": { ok: false, status: 403, body: { error: "setting a selection LOCK requires a fresh step-up" } },
    });
    renderWithProviders(<DefBindingControl slot="projects" kind="screen" projectId="p1" />, { client: seed("admin") });
    fireEvent.change(await screen.findByTestId("def-binding-scope-projects"), { target: { value: "org" } });
    fireEvent.click(screen.getByTestId("def-binding-lock-projects"));
    fireEvent.click(screen.getByTestId("def-binding-save-projects"));
    expect(await screen.findByTestId("def-binding-stepup-projects")).toBeTruthy();
  });
});
