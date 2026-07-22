import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { FormsAdmin } from "./FormsAdmin";
import type { FormDef } from "../../lib/forms";

/**
 * FormsAdmin — the visual builder for intake forms (admin/PMO). Forms are ARTIFACTS in the def store now, so
 * the admin reads the org-scoped `form` defs and a save is a per-def upsert through the importer
 * (`POST`/`PUT /api/defs`). Covers RBAC gating, adding from a shipped template, and saving via the importer.
 */
function seed(role: string | undefined, orgForms: FormDef[] = [], legacyForms: FormDef[] = [], caps?: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  // The org form defs the admin edits (resolved-defs key; storage inferred from the `org~` id prefix).
  qc.setQueryData(["defs", "resolved", "form", null, null], orgForms.map((f, i) => ({
    id: `org~f${i}`, kind: "form", name: f.label, storage: "org", payload: f, createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1,
  })));
  qc.setQueryData(["forms", "legacy"], legacyForms);
  if (caps !== undefined) qc.setQueryData(["/api/capabilities"], caps);
  return qc;
}

function form(over: Partial<FormDef> = {}): FormDef {
  return {
    id: "formA", label: "A",
    fields: [{ key: "summary", label: "Summary", type: "text", mapTo: "title", required: true }],
    target: { kind: "issue" },
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("FormsAdmin", () => {
  it("renders nothing below PMO", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("manager") });
    expect(screen.queryByTestId("forms-admin")).not.toBeInTheDocument();
  });

  it("shows the builder for a PMO with an empty state", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("pmo") });
    expect(screen.getByTestId("forms-admin")).toBeInTheDocument();
    expect(screen.getByTestId("forms-empty")).toBeInTheDocument();
  });

  it("the field-type picker is driven by the shared store, grouped into subfolders", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("pmo") });
    fireEvent.click(screen.getByTestId("form-add-blank"));
    const typeSelect = screen.getByLabelText("Field 1 type");
    const options = Array.from(typeSelect.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual(expect.arrayContaining(["text", "select", "email", "url", "checkbox"]));
    const groups = Array.from(typeSelect.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));
    expect(groups).toEqual(expect.arrayContaining(["text", "choice", "boolean"]));
  });

  it("adds a form from a template and saves it as a new def via POST /api/defs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    renderWithProviders(<FormsAdmin />, { client: seed("admin") });
    const sel = screen.getByTestId("form-template-select") as HTMLSelectElement;
    const firstValue = Array.from(sel.querySelectorAll("option")).map((o) => o.value).find((v) => v !== "")!;
    fireEvent.change(sel, { target: { value: firstValue } });
    fireEvent.click(screen.getByTestId("form-add-template"));
    fireEvent.change(screen.getByLabelText("Form 1 target project"), { target: { value: "proj-001" } });
    fireEvent.click(screen.getByTestId("forms-save"));
    const post = await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/defs" && (i as RequestInit)?.method === "POST");
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((post[1] as RequestInit).body as string) as { kind: string; storage: string; payload: FormDef };
    expect(body.kind).toBe("form");
    expect(body.storage).toBe("org");
    expect(body.payload.target.projectId).toBe("proj-001");
    expect(body.payload.fields.length).toBeGreaterThan(0);
  });

  it("offers a migration when legacy settings.forms are present", () => {
    const legacy: FormDef = { id: "old", label: "Old form", fields: [{ key: "s", label: "S", type: "text", mapTo: "title", required: true }], target: { kind: "issue", projectId: "p1" } };
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [], [legacy]) });
    expect(screen.getByTestId("forms-migrate-legacy")).toBeInTheDocument();
  });
});

describe("FormsAdmin — RBAC edge", () => {
  it("renders nothing for a contributor", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("contributor") });
    expect(screen.queryByTestId("forms-admin")).not.toBeInTheDocument();
  });

  it("lists an org-scoped form row", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [form({ id: "formA", label: "A" })]) });
    expect(screen.getByTestId("form-row-formA")).toBeInTheDocument();
  });
});

describe("FormsAdmin — build + edit", () => {
  it("adds a blank form and enables Save (valid + dirty)", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin") });
    expect(screen.getByTestId("forms-save")).toBeDisabled();
    fireEvent.click(screen.getByTestId("form-add-blank"));
    expect(screen.getByTestId("form-row-form")).toBeInTheDocument();
    expect(screen.getByTestId("forms-save")).toBeEnabled();
  });

  it("ignores Add-from-template when nothing is selected (button disabled)", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin") });
    expect(screen.getByTestId("form-add-template")).toBeDisabled();
  });

  it("adds and removes a field on a form", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [form()]) });
    fireEvent.click(screen.getByTestId("form-formA-add-field"));
    expect(screen.getByLabelText("Field 2 key")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove field 2"));
    expect(screen.queryByLabelText("Field 2 key")).toBeNull();
  });

  it("reveals an options input when a field's type becomes select", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [form()]) });
    expect(screen.queryByLabelText("Field 1 options")).toBeNull();
    fireEvent.change(screen.getByLabelText("Field 1 type"), { target: { value: "select" } });
    expect(screen.getByLabelText("Field 1 options")).toBeInTheDocument();
  });

  it("toggles a field's Required and a form's Enabled flag", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [form()]) });
    fireEvent.click(screen.getByTestId("form-enabled-formA"));
    fireEvent.click(screen.getByLabelText("Field 1 required"));
    // No crash + the draft is now dirty (Save enabled since the form stays valid).
    expect(screen.getByTestId("forms-save")).toBeEnabled();
  });

  it("removes a whole form row", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [form()]) });
    fireEvent.click(screen.getByTestId("form-remove-formA"));
    expect(screen.queryByTestId("form-row-formA")).toBeNull();
  });

  it("resets the draft after an edit", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [form({ label: "A" })]) });
    fireEvent.change(screen.getByLabelText("Form 1 label"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: /^reset$/i }));
    expect((screen.getByLabelText("Form 1 label") as HTMLInputElement).value).toBe("A");
  });
});

describe("FormsAdmin — validation branches", () => {
  const badText = () => screen.getByTestId("form-bad-formA").textContent;
  function render(payload: FormDef, caps?: unknown) {
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [payload], [], caps) });
  }

  it("flags a blank id/label", () => {
    render(form({ label: "" }));
    expect(badText()).toMatch(/id and label required/);
    expect(screen.getByTestId("forms-save")).toBeDisabled();
  });

  it("flags a form with no fields", () => {
    render(form({ fields: [] }));
    expect(badText()).toMatch(/at least one field/);
  });

  it("flags a field missing its key/label", () => {
    render(form({ fields: [{ key: "", label: "", type: "text", mapTo: "title" }] }));
    expect(badText()).toMatch(/needs a key and label/);
  });

  it("flags duplicate field keys", () => {
    render(form({ fields: [
      { key: "dup", label: "One", type: "text", mapTo: "title" },
      { key: "dup", label: "Two", type: "text", mapTo: "description" },
    ] }));
    expect(badText()).toMatch(/duplicate field key/);
  });

  it("flags a select field with no options", () => {
    render(form({ fields: [{ key: "s", label: "Sel", type: "select", mapTo: "title", options: [] }] }));
    expect(badText()).toMatch(/needs options/);
  });

  it("flags an unmapped field", () => {
    render(form({ fields: [{ key: "k", label: "K", type: "text", mapTo: "" }] }));
    expect(badText()).toMatch(/must map to a backend field/);
  });

  it("flags a field mapped to an unstorable target (capability-gated)", () => {
    render(form({ fields: [
      { key: "summary", label: "S", type: "text", mapTo: "title" },
      { key: "p", label: "P", type: "text", mapTo: "priority" },
    ] }), { fields: { priority: { store: false, surface: true } } });
    expect(badText()).toMatch(/backend can't store/);
  });

  it("flags the wrong number of title fields", () => {
    render(form({ fields: [{ key: "k", label: "K", type: "text", mapTo: "description" }] }));
    expect(badText()).toMatch(/exactly one field must map to "title"/);
  });

  it("flags two fields mapping to the same scalar target", () => {
    render(form({ fields: [
      { key: "a", label: "A", type: "text", mapTo: "title" },
      { key: "b", label: "B", type: "number", mapTo: "budget" },
      { key: "c", label: "C", type: "number", mapTo: "budget" },
    ] }));
    expect(badText()).toMatch(/two fields map to "budget"/);
  });
});

describe("FormsAdmin — save round-trip", () => {
  it("PUTs an existing form and POSTs a new one, then toasts success", async () => {
    const calls = mockFetchRouter({ "GET /api/defs/resolved/form": { ok: true, body: [] } });
    renderWithProviders(<><FormsAdmin /><Toaster /></>, { client: seed("admin", [form({ id: "formA", label: "A" })]) });
    fireEvent.change(screen.getByLabelText("Form 1 label"), { target: { value: "A2" } });
    fireEvent.click(screen.getByTestId("form-add-blank"));
    fireEvent.click(screen.getByTestId("forms-save"));
    await waitFor(() => expect(screen.getByText("FORMS SAVED")).toBeInTheDocument());
    expect(calls.some((c) => c.init?.method === "PUT" && c.url.endsWith("/api/defs/org~f0"))).toBe(true);
    expect(calls.some((c) => c.init?.method === "POST" && c.url.endsWith("/api/defs"))).toBe(true);
  });

  it("DELETEs a def whose form was removed from the draft", async () => {
    const calls = mockFetchRouter({ "GET /api/defs/resolved/form": { ok: true, body: [] } });
    renderWithProviders(<><FormsAdmin /><Toaster /></>, { client: seed("admin", [form({ id: "formA", label: "A" })]) });
    fireEvent.click(screen.getByTestId("form-remove-formA"));
    fireEvent.click(screen.getByTestId("forms-save"));
    await waitFor(() => expect(screen.getByText("FORMS SAVED")).toBeInTheDocument());
    expect(calls.some((c) => c.init?.method === "DELETE" && c.url.endsWith("/api/defs/org~f0"))).toBe(true);
  });

  it("toasts the server error when a save fails", async () => {
    mockFetchRouter({ "POST /api/defs": { ok: false, status: 403, body: { error: "scope denied" } } });
    renderWithProviders(<><FormsAdmin /><Toaster /></>, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("form-add-blank"));
    fireEvent.click(screen.getByTestId("forms-save"));
    expect(await screen.findByText("COULD NOT SAVE")).toBeInTheDocument();
    expect(screen.getByText("scope denied")).toBeInTheDocument();
  });
});

describe("FormsAdmin — legacy migration", () => {
  it("shows no migrate button when there is no legacy slice", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin") });
    expect(screen.queryByTestId("forms-migrate-legacy")).toBeNull();
  });

  it("pluralises the migrate label for several legacy forms", () => {
    renderWithProviders(<FormsAdmin />, { client: seed("admin", [], [form({ id: "l1" }), form({ id: "l2" })]) });
    expect(screen.getByTestId("forms-migrate-legacy")).toHaveTextContent(/Migrate 2 legacy forms/);
  });

  it("imports each legacy form then drains, and toasts", async () => {
    const calls = mockFetchRouter({ "GET /api/defs/resolved/form": { ok: true, body: [] } });
    renderWithProviders(<><FormsAdmin /><Toaster /></>, { client: seed("admin", [], [form({ id: "legacy1", label: "Legacy 1" })]) });
    fireEvent.click(screen.getByTestId("forms-migrate-legacy"));
    await waitFor(() => expect(screen.getByText("MIGRATED")).toBeInTheDocument());
    expect(calls.some((c) => c.init?.method === "POST" && c.url.endsWith("/api/defs"))).toBe(true);
    expect(calls.some((c) => c.init?.method === "PUT" && c.url.endsWith("/api/forms"))).toBe(true);
  });

  it("skips a legacy form already present in the def store (drain only)", async () => {
    const calls = mockFetchRouter({ "GET /api/defs/resolved/form": { ok: true, body: [] } });
    renderWithProviders(<><FormsAdmin /><Toaster /></>, { client: seed("admin", [form({ id: "dupe", label: "Dupe" })], [form({ id: "dupe", label: "Dupe" })]) });
    fireEvent.click(screen.getByTestId("forms-migrate-legacy"));
    await waitFor(() => expect(screen.getByText("MIGRATED")).toBeInTheDocument());
    expect(calls.some((c) => c.init?.method === "PUT" && c.url.endsWith("/api/forms"))).toBe(true);
    expect(calls.some((c) => c.init?.method === "POST" && c.url.endsWith("/api/defs"))).toBe(false);
  });

  it("toasts a failure when the drain step fails", async () => {
    mockFetchRouter({ "PUT /api/forms": { ok: false, status: 500, body: { error: "drain down" } }, "GET /api/defs/resolved/form": { ok: true, body: [] } });
    renderWithProviders(<><FormsAdmin /><Toaster /></>, { client: seed("admin", [], [form({ id: "l1", label: "L1" })]) });
    fireEvent.click(screen.getByTestId("forms-migrate-legacy"));
    expect(await screen.findByText("MIGRATION FAILED")).toBeInTheDocument();
  });
});
