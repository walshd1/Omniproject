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

  it("shows the no-form-configured copy when the panel has no formId at all", () => {
    const noId: Panel = { id: "p", kind: "form", config: {} };
    renderWithProviders(<FormPanel panel={noId} />, { client: seed([]) });
    expect(screen.getByTestId("form-missing")).toHaveTextContent("This panel has no form configured.");
  });

  it("renders the form description and every field-input primitive", () => {
    const big: FormDef = {
      id: "kitchen-sink", label: "Everything", description: "Fill it all in",
      fields: [
        { key: "note", label: "Note", type: "textarea", mapTo: "description" },
        { key: "count", label: "Count", type: "number", mapTo: "count" },
        { key: "due", label: "Due", type: "date", mapTo: "dueDate" },
        { key: "email", label: "Email", type: "email", mapTo: "email" },
        { key: "link", label: "Link", type: "url", mapTo: "url" },
        { key: "agree", label: "Agree", type: "checkbox", mapTo: "agree" },
        { key: "ok", label: "OK?", type: "yesno", mapTo: "ok" },
        { key: "band", label: "Band", type: "radio", mapTo: "band", options: ["A", "B"] },
        { key: "score", label: "Score", type: "likert", mapTo: "score", options: ["Low", "High"] },
        { key: "tags", label: "Tags", type: "multiselect", mapTo: "labels", options: ["x", "y"] },
        { key: "addr", label: "Address", type: "address", mapTo: "address" },
      ],
      target: { kind: "issue", projectId: "proj-001" },
    };
    renderWithProviders(<FormPanel panel={{ id: "p", kind: "form", config: { formId: "kitchen-sink" } }} />, { client: seed([big]) });
    expect(screen.getByText("Fill it all in")).toBeInTheDocument();
    for (const k of ["note", "count", "due", "email", "link", "agree", "ok", "band", "score", "tags", "addr"]) {
      expect(screen.getByTestId(`form-field-${k}`)).toBeInTheDocument();
    }
    // Address renders its sub-part inputs.
    expect(screen.getByTestId("form-field-addr-line1")).toBeInTheDocument();
  });

  it("edits checkbox, yesno, radio, likert, multiselect and address fields and submits them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, issue: {} }), { status: 201 }));
    const big: FormDef = {
      id: "editable", label: "Editable",
      fields: [
        { key: "agree", label: "Agree", type: "checkbox", mapTo: "agree" },
        { key: "ok", label: "OK?", type: "yesno", mapTo: "ok" },
        { key: "band", label: "Band", type: "radio", mapTo: "band", options: ["A", "B"] },
        { key: "tags", label: "Tags", type: "multiselect", mapTo: "labels", options: ["x", "y"] },
        { key: "addr", label: "Address", type: "address", mapTo: "address" },
      ],
      target: { kind: "issue", projectId: "proj-001" },
    };
    renderWithProviders(<FormPanel panel={{ id: "p", kind: "form", config: { formId: "editable" } }} />, { client: seed([big]) });

    fireEvent.click(screen.getByTestId("form-field-agree")); // checkbox on
    // yesno: pick "Yes"
    fireEvent.click(screen.getByLabelText("Yes"));
    fireEvent.click(screen.getByLabelText("A")); // radio
    fireEvent.click(screen.getByLabelText("x")); // multiselect on
    fireEvent.click(screen.getByLabelText("y")); // multiselect add second
    fireEvent.click(screen.getByLabelText("y")); // toggle second back off (covers the filter branch)
    fireEvent.change(screen.getByTestId("form-field-addr-line1"), { target: { value: "1 High St" } });

    fireEvent.click(screen.getByTestId("form-submit"));
    const call = await waitFor(() => {
      const c = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/submit") && (i as RequestInit)?.method === "POST");
      expect(c).toBeTruthy();
      return c!;
    });
    const body = JSON.parse((call[1] as RequestInit).body as string) as { values: Record<string, unknown> };
    expect(body.values).toMatchObject({ agree: true, ok: true, band: "A", tags: ["x"], addr: { line1: "1 High St" } });
  });

  it("flags invalid number, email, url and over-length values", () => {
    const validated: FormDef = {
      id: "validated", label: "Validated",
      fields: [
        { key: "count", label: "Count", type: "number", mapTo: "count" },
        { key: "email", label: "Email", type: "email", mapTo: "email" },
        { key: "link", label: "Link", type: "url", mapTo: "url" },
        { key: "short", label: "Short", type: "text", mapTo: "title", maxLength: 3 },
      ],
      target: { kind: "issue", projectId: "proj-001" },
    };
    renderWithProviders(<FormPanel panel={{ id: "p", kind: "form", config: { formId: "validated" } }} />, { client: seed([validated]) });
    // A valid number keeps the number branch happy (jsdom sanitises non-numeric input to "").
    fireEvent.change(screen.getByTestId("form-field-count"), { target: { value: "12" } });
    fireEvent.change(screen.getByTestId("form-field-email"), { target: { value: "bad-email" } });
    fireEvent.change(screen.getByTestId("form-field-link"), { target: { value: "ftp://nope" } });
    fireEvent.change(screen.getByTestId("form-field-short"), { target: { value: "toolong" } });
    fireEvent.submit(screen.getByTestId("intake-form"));
    expect(screen.queryByTestId("form-error-count")).toBeNull();
    expect(screen.getByTestId("form-error-email")).toHaveTextContent(/valid email/);
    expect(screen.getByTestId("form-error-link")).toHaveTextContent(/valid http/);
    expect(screen.getByTestId("form-error-short")).toHaveTextContent(/at most 3/);
  });

  it("surfaces a destructive toast when the submission fails, keeping the form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    renderWithProviders(<FormPanel panel={panel} />, { client: seed([FORM]) });
    fireEvent.change(screen.getByTestId("form-field-summary"), { target: { value: "X" } });
    fireEvent.change(screen.getByTestId("form-field-priority"), { target: { value: "High" } });
    fireEvent.click(screen.getByTestId("form-submit"));
    // On error the success banner never appears and the form stays mounted.
    await waitFor(() => expect(screen.getByTestId("form-submit")).not.toBeDisabled());
    expect(screen.queryByTestId("form-success")).toBeNull();
    expect(screen.getByTestId("intake-form")).toBeInTheDocument();
  });

  it("lets the user submit another after a success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, issue: {} }), { status: 201 }));
    renderWithProviders(<FormPanel panel={panel} />, { client: seed([FORM]) });
    fireEvent.change(screen.getByTestId("form-field-summary"), { target: { value: "Fix" } });
    fireEvent.change(screen.getByTestId("form-field-priority"), { target: { value: "Low" } });
    fireEvent.click(screen.getByTestId("form-submit"));
    await waitFor(() => expect(screen.getByTestId("form-success")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("form-again"));
    // Back to a fresh, empty form.
    expect(screen.getByTestId("intake-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-field-summary")).toHaveValue("");
  });
});
