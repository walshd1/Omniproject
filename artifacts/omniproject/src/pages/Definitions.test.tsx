import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../test/utils";
import { defsKey, defKey, type StoredDefMeta } from "../lib/defs";
import { Toaster } from "../components/ui/toaster";
import { Definitions } from "./Definitions";

/** The Definitions (importer) page: list, JSON-parse guard, validate dry-run, and save gating. */
function seed(items: StoredDefMeta[] = [], role = "admin"): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData([...defsKey, null, null], items);
  // The importer/editor is open to every author; the def-policy scopes what each may write where.
  qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["defs", "policy"], { policy: { user: "contributor", project: "manager", org: "pmoOrAdmin" }, gates: ["contributor", "manager", "pmoOrAdmin", "admin"] });
  return qc;
}
const meta = (over: Partial<StoredDefMeta> = {}): StoredDefMeta => ({
  id: "user~abc", kind: "primitive", name: "My chart", storage: "user",
  createdBy: "cee@x.io", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

afterEach(() => { vi.restoreAllMocks(); resetFetchMock(); });

const storedDef = (over: Record<string, unknown> = {}) => ({
  id: "user~e1", kind: "primitive", name: "Editable", storage: "user",
  createdBy: "cee@x.io", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  rowVersion: 1, payload: { id: "grouped-column", label: "Grouped columns" }, ...over,
});

describe("Definitions page", () => {
  it("lists stored definitions with their kind and storage", () => {
    renderWithProviders(<Definitions />, { client: seed([meta(), meta({ id: "org~x", name: "Org form", kind: "form", storage: "org" })]) });
    expect(screen.getByTestId("def-row-user~abc")).toHaveTextContent("My chart");
    expect(screen.getByTestId("def-row-org~x")).toHaveTextContent("org");
  });

  it("guards invalid JSON before validating", () => {
    renderWithProviders(<Definitions />, { client: seed() });
    fireEvent.change(screen.getByTestId("def-payload"), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByTestId("def-validate"));
    expect(screen.getByTestId("def-parse-error")).toBeInTheDocument();
  });

  it("shows validation errors from the dry-run", async () => {
    mockFetchRouter({ "POST /api/defs/validate": { ok: true, body: { valid: false, errors: ["id must be kebab-case"] } } });
    renderWithProviders(<Definitions />, { client: seed() });
    fireEvent.change(screen.getByTestId("def-payload"), { target: { value: '{"id":"Bad Id"}' } });
    fireEvent.click(screen.getByTestId("def-validate"));
    await waitFor(() => expect(screen.getByTestId("def-errors")).toBeInTheDocument());
    expect(screen.getByTestId("def-errors")).toHaveTextContent(/kebab-case/);
  });

  it("save is disabled until a name and payload are present", () => {
    renderWithProviders(<Definitions />, { client: seed() });
    expect(screen.getByTestId("def-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("def-payload"), { target: { value: "{}" } });
    fireEvent.change(screen.getByTestId("def-name"), { target: { value: "My def" } });
    expect(screen.getByTestId("def-save")).not.toBeDisabled();
  });

  it("reveals a project-id field when the project store is chosen", () => {
    renderWithProviders(<Definitions />, { client: seed() });
    expect(screen.queryByTestId("def-project")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("def-storage"), { target: { value: "project" } });
    expect(screen.getByTestId("def-project")).toBeInTheDocument();
  });

  it("scopes the storage targets to what the author may write (a contributor gets only their private area)", () => {
    renderWithProviders(<Definitions />, { client: seed([], "contributor") });
    const options = [...(screen.getByTestId("def-storage") as HTMLSelectElement).options].map((o) => o.value);
    // Default policy: user → contributor, project → manager, org → pmoOrAdmin. A contributor clears only `user`.
    expect(options).toEqual(["user"]);
  });

  it("surfaces a SELECT + LOCK control for each activated (non-shipped) primitive family, but not shipped ones", () => {
    const client = seed();
    // The resolved-primitive set: one org-ACTIVATED primitive (lockable) + one shipped `system~` baseline (not).
    client.setQueryData([...defsKey, "resolved", "primitive", null, null], [
      { id: "org~reg-abc", kind: "primitive", name: "Acme tile", storage: "org", createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1, payload: { id: "acme-tile", label: "Acme tile" } },
      { id: "system~bar", kind: "primitive", name: "Bar", storage: "system", createdBy: "system", createdAt: "", updatedAt: "", rowVersion: 1, payload: { id: "bar", label: "Bar" } },
    ]);
    client.setQueryData([...defsKey, "active", null, null], {});
    renderWithProviders(<Definitions />, { client });
    expect(screen.getByTestId("primitive-locks")).toBeInTheDocument();
    // A lock control for the activated primitive, keyed on its namespaced slot …
    expect(screen.getByTestId("def-binding-primitive:acme-tile")).toBeInTheDocument();
    // … but none for the shipped `bar` (nothing to override).
    expect(screen.queryByTestId("def-binding-primitive:bar")).not.toBeInTheDocument();
    // Choosing an org scope (admin) reveals the LOCK — mandate it down the subtree.
    fireEvent.change(screen.getByTestId("def-binding-scope-primitive:acme-tile"), { target: { value: "org" } });
    expect(screen.getByTestId("def-binding-lock-primitive:acme-tile")).toBeInTheDocument();
  });

  it("hides the primitive-locks panel entirely when no primitives are activated", () => {
    const client = seed();
    client.setQueryData([...defsKey, "resolved", "primitive", null, null], [
      { id: "system~bar", kind: "primitive", name: "Bar", storage: "system", createdBy: "system", createdAt: "", updatedAt: "", rowVersion: 1, payload: { id: "bar", label: "Bar" } },
    ]);
    renderWithProviders(<Definitions />, { client });
    expect(screen.queryByTestId("primitive-locks")).not.toBeInTheDocument();
  });

  it("opens the editor for a row and seeds it with the def's payload", async () => {
    const client = seed([meta({ id: "user~e1", name: "Editable" })]);
    client.setQueryData(defKey("user~e1"), {
      id: "user~e1", kind: "primitive", name: "Editable", storage: "user",
      createdBy: "cee@x.io", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      rowVersion: 1, payload: { id: "grouped-column", label: "Grouped columns" },
    });
    renderWithProviders(<Definitions />, { client });
    fireEvent.click(screen.getByTestId("def-edit-btn-user~e1"));
    await waitFor(() => expect(screen.getByTestId("def-edit-user~e1")).toBeInTheDocument());
    expect((screen.getByTestId("def-edit-name") as HTMLInputElement).value).toBe("Editable");
    expect((screen.getByTestId("def-edit-payload") as HTMLTextAreaElement).value).toContain("grouped-column");
  });

  it("shows the empty-state note when there are no stored definitions", () => {
    renderWithProviders(<Definitions />, { client: seed([]) });
    expect(screen.getByText(/No stored definitions yet/i)).toBeInTheDocument();
  });

  it("surfaces a list load error with a Retry", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    qc.setQueryData(["auth", "me"], { sub: "u1", role: "admin" });
    qc.setQueryData(["defs", "policy"], { policy: { user: "contributor", project: "manager", org: "pmoOrAdmin" }, gates: [] });
    mockFetchRouter({ "GET /api/defs": { ok: false, status: 500, body: { error: "store down" } } });
    renderWithProviders(<Definitions />, { client: qc });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("confirms a valid payload from the dry-run", async () => {
    mockFetchRouter({ "POST /api/defs/validate": { ok: true, body: { valid: true, errors: [] } } });
    renderWithProviders(<Definitions />, { client: seed() });
    fireEvent.change(screen.getByTestId("def-payload"), { target: { value: '{"id":"ok"}' } });
    fireEvent.click(screen.getByTestId("def-validate"));
    await waitFor(() => expect(screen.getByTestId("def-valid")).toBeInTheDocument());
  });

  it("does not mutate when Save is clicked with invalid JSON", () => {
    const calls = mockFetchRouter({});
    renderWithProviders(<Definitions />, { client: seed() });
    fireEvent.change(screen.getByTestId("def-name"), { target: { value: "N" } });
    fireEvent.change(screen.getByTestId("def-payload"), { target: { value: "{ nope" } });
    fireEvent.click(screen.getByTestId("def-save"));
    expect(screen.getByTestId("def-parse-error")).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("saves an import, toasts, and clears the form", async () => {
    mockFetchRouter({ "POST /api/defs": { ok: true, body: { name: "My def" } }, "GET /api/defs": { ok: true, body: [] } });
    renderWithProviders(<><Definitions /><Toaster /></>, { client: seed() });
    fireEvent.change(screen.getByTestId("def-name"), { target: { value: "My def" } });
    fireEvent.change(screen.getByTestId("def-payload"), { target: { value: '{"id":"x"}' } });
    fireEvent.click(screen.getByTestId("def-save"));
    await waitFor(() => expect(screen.getByText("SAVED")).toBeInTheDocument());
    expect(screen.getByText(/My def → My private area/)).toBeInTheDocument();
    expect((screen.getByTestId("def-name") as HTMLInputElement).value).toBe("");
  });

  it("surfaces a rejection when the import is refused", async () => {
    mockFetchRouter({ "POST /api/defs": { ok: false, status: 403, body: { error: "no" } } });
    renderWithProviders(<Definitions />, { client: seed() });
    fireEvent.change(screen.getByTestId("def-name"), { target: { value: "My def" } });
    fireEvent.change(screen.getByTestId("def-payload"), { target: { value: '{"id":"x"}' } });
    fireEvent.click(screen.getByTestId("def-save"));
    await waitFor(() => expect(screen.getByTestId("def-errors")).toHaveTextContent(/import was rejected/i));
  });

  it("offers the programme store + programme-id field when the policy permits it", () => {
    const qc = seed([], "admin");
    qc.setQueryData(["defs", "policy"], { policy: { user: "contributor", project: "manager", programme: "programmeManager", org: "pmoOrAdmin" }, gates: [] });
    renderWithProviders(<Definitions />, { client: qc });
    fireEvent.change(screen.getByTestId("def-storage"), { target: { value: "programme" } });
    expect(screen.getByTestId("def-programme")).toBeInTheDocument();
  });

  it("deletes a stored def via its row action", async () => {
    const calls = mockFetchRouter({ "DELETE /api/defs/user~abc": { ok: true }, "GET /api/defs": { ok: true, body: [] } });
    renderWithProviders(<Definitions />, { client: seed([meta()]) });
    fireEvent.click(screen.getByTestId("def-delete-user~abc"));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE" && c.url.includes("user~abc"))).toBe(true));
  });
});

describe("Definitions — edit panel", () => {
  function openEditor(client: QueryClient) {
    const r = renderWithProviders(<><Definitions /><Toaster /></>, { client });
    fireEvent.click(screen.getByTestId("def-edit-btn-user~e1"));
    return r;
  }
  function seededForEdit(): QueryClient {
    const qc = seed([meta({ id: "user~e1", name: "Editable" })]);
    qc.setQueryData(defKey("user~e1"), storedDef());
    return qc;
  }

  it("validates the edited payload (valid → confirmation)", async () => {
    const qc = seededForEdit();
    mockFetchRouter({ "POST /api/defs/validate": { ok: true, body: { valid: true, errors: [] } } });
    openEditor(qc);
    await waitFor(() => expect(screen.getByTestId("def-edit-payload")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("def-edit-validate"));
    await waitFor(() => expect(screen.getByText(/^Valid\.$/)).toBeInTheDocument());
  });

  it("surfaces validation errors from the edit dry-run", async () => {
    const qc = seededForEdit();
    mockFetchRouter({ "POST /api/defs/validate": { ok: true, body: { valid: false, errors: ["bad id"] } } });
    openEditor(qc);
    await waitFor(() => expect(screen.getByTestId("def-edit-payload")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("def-edit-validate"));
    await waitFor(() => expect(screen.getByTestId("def-edit-errors")).toHaveTextContent(/bad id/));
  });

  it("guards invalid JSON in the editor before validating", async () => {
    const qc = seededForEdit();
    mockFetchRouter({});
    openEditor(qc);
    await waitFor(() => expect(screen.getByTestId("def-edit-payload")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("def-edit-payload"), { target: { value: "{ not json" } });
    fireEvent.click(screen.getByTestId("def-edit-validate"));
    expect(screen.getByTestId("def-edit-parse-error")).toBeInTheDocument();
  });

  it("saves an edit, toasts, and closes back to the import panel", async () => {
    const qc = seededForEdit();
    mockFetchRouter({ "PUT /api/defs/user~e1": { ok: true, body: {} }, "GET /api/defs": { ok: true, body: [] } });
    openEditor(qc);
    await waitFor(() => expect(screen.getByTestId("def-edit-payload")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("def-edit-save"));
    await waitFor(() => expect(screen.getByText("SAVED")).toBeInTheDocument());
    // Editor closed → the import panel is back.
    expect(screen.getByTestId("def-import-panel")).toBeInTheDocument();
  });

  it("surfaces a rejection when the edit is refused", async () => {
    const qc = seededForEdit();
    mockFetchRouter({ "PUT /api/defs/user~e1": { ok: false, status: 403, body: { error: "no" } } });
    openEditor(qc);
    await waitFor(() => expect(screen.getByTestId("def-edit-payload")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("def-edit-save"));
    await waitFor(() => expect(screen.getByTestId("def-edit-errors")).toHaveTextContent(/edit was rejected/i));
  });

  it("cancels the editor without saving", async () => {
    const qc = seededForEdit();
    mockFetchRouter({});
    openEditor(qc);
    await waitFor(() => expect(screen.getByTestId("def-edit-payload")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByTestId("def-import-panel")).toBeInTheDocument();
  });

  it("surfaces a load error in the editor with a Retry", async () => {
    const qc = seed([meta({ id: "user~e1", name: "Editable" })]);
    mockFetchRouter({ "GET /api/defs/user~e1": { ok: false, status: 500, body: { error: "gone" } } });
    openEditor(qc);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
