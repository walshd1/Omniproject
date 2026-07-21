import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { FormsAdmin } from "./FormsAdmin";
import type { FormDef } from "../../lib/forms";

/**
 * FormsAdmin — the visual builder for intake forms (admin/PMO). Forms are ARTIFACTS in the def store now, so
 * the admin reads the org-scoped `form` defs and a save is a per-def upsert through the importer
 * (`POST`/`PUT /api/defs`). Covers RBAC gating, adding from a shipped template, and saving via the importer.
 */
function seed(role: string | undefined, orgForms: FormDef[] = [], legacyForms: FormDef[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  // The org form defs the admin edits (resolved-defs key; storage inferred from the `org~` id prefix).
  qc.setQueryData(["defs", "resolved", "form", null, null], orgForms.map((f, i) => ({
    id: `org~f${i}`, kind: "form", name: f.label, payload: f, createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1,
  })));
  qc.setQueryData(["forms", "legacy"], legacyForms);
  return qc;
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
