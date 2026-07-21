import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../../test/utils";
import { formsResolvedKey } from "../../../lib/forms";
import { FormPanel } from "./FormPanel";
import type { Panel } from "../../../lib/screen";
import type { FormDef } from "../../../lib/forms";

/**
 * FormPanel renders an intake form resolved from the def store (`GET /api/forms/resolved`, via `useForms`) and,
 * on submit, POSTs to /api/forms/:id/submit. Covers: the empty state for an unconfigured form, client-side
 * required-field validation, and a successful submission.
 */
const FORM: FormDef = {
  id: "intake-request", label: "Work request",
  fields: [
    { key: "summary", label: "Summary", type: "text", mapTo: "title", required: true },
    { key: "priority", label: "Priority", type: "select", mapTo: "priority", options: ["Low", "High"], required: true },
  ],
  target: { kind: "issue", projectId: "proj-001" },
};

function seed(forms: FormDef[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(formsResolvedKey, forms); // the resolved submittable set useForms() reads
  return qc;
}

const panel: Panel = { id: "p", kind: "form", title: "New request", config: { formId: "intake-request" } };

afterEach(() => vi.restoreAllMocks());

describe("FormPanel", () => {
  it("shows an empty state when the form id isn't configured", () => {
    renderWithProviders(<FormPanel panel={panel} />, { client: seed([]) });
    expect(screen.getByTestId("form-missing")).toBeInTheDocument();
  });

  it("renders the form's fields from the org config", () => {
    renderWithProviders(<FormPanel panel={panel} />, { client: seed([FORM]) });
    expect(screen.getByTestId("form-field-summary")).toBeInTheDocument();
    expect(screen.getByTestId("form-field-priority")).toBeInTheDocument();
  });

  it("blocks submission and shows errors when required fields are empty", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<FormPanel panel={panel} />, { client: seed([FORM]) });
    fireEvent.submit(screen.getByTestId("intake-form"));
    expect(screen.getByTestId("form-error-summary")).toBeInTheDocument();
    // No network call fired.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/submit"))).toBe(false);
  });

  it("submits valid values to /api/forms/:id/submit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, issue: { id: "x" } }), { status: 201 }));
    renderWithProviders(<FormPanel panel={panel} />, { client: seed([FORM]) });
    fireEvent.change(screen.getByTestId("form-field-summary"), { target: { value: "Fix login" } });
    fireEvent.change(screen.getByTestId("form-field-priority"), { target: { value: "High" } });
    fireEvent.click(screen.getByTestId("form-submit"));
    const call = await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => String(u) === "/api/forms/intake-request/submit" && (i as RequestInit)?.method === "POST");
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((call[1] as RequestInit).body as string) as { values: Record<string, unknown> };
    expect(body.values).toMatchObject({ summary: "Fix login", priority: "High" });
    await waitFor(() => expect(screen.getByTestId("form-success")).toBeInTheDocument());
  });
});
