import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter } from "../test/utils";
import { studioStatusKey, type PrimitiveStudioResult } from "../lib/studio";
import { Studio } from "./Studio";

/** The Primitive Studio page: generate → verdict + preview → refine/submit gating. */
function seed(available = true): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(studioStatusKey, { available });
  return qc;
}

const validResult: PrimitiveStudioResult = {
  submission: { kind: "primitive", name: "Grouped columns", publisher: "AI", version: "1.0.0", description: "", tags: [], payload: { id: "grouped-column" } },
  valid: true,
  errors: [],
  def: { id: "grouped-column", label: "Grouped columns", category: "chart", chartType: "bar", description: "", params: [{ key: "data", label: "Rows", type: "rows", required: true, description: "" }] },
};
const invalidResult: PrimitiveStudioResult = {
  submission: { kind: "primitive", name: "Bad", publisher: "AI", version: "1.0.0", description: "", tags: [], payload: { id: "Bad" } },
  valid: false,
  errors: ["id must be kebab-case", "params must be a non-empty array"],
};

afterEach(() => { vi.restoreAllMocks(); });

describe("Studio page", () => {
  it("warns when no AI provider is available", () => {
    renderWithProviders(<Studio />, { client: seed(false) });
    expect(screen.getByTestId("studio-unavailable")).toBeInTheDocument();
  });

  it("generates, shows a valid verdict + preview, and enables submit", async () => {
    mockFetchRouter({ "POST /api/studio/primitive": { ok: true, body: { result: validResult } } });
    renderWithProviders(<Studio />, { client: seed() });
    fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "a grouped column chart" } });
    fireEvent.click(screen.getByTestId("studio-generate"));
    await waitFor(() => expect(screen.getByTestId("studio-result")).toBeInTheDocument());
    expect(screen.getByTestId("studio-valid")).toBeInTheDocument();
    expect(screen.getByTestId("studio-preview")).toBeInTheDocument();
    expect(screen.getByTestId("studio-submit")).not.toBeDisabled();
  });

  it("saves a valid primitive through the definition importer at the chosen scope", async () => {
    let importBody: unknown;
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/studio/primitive")) return new Response(JSON.stringify({ result: validResult }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/api/defs")) { importBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "user~x", name: "Grouped columns", kind: "primitive", storage: "user" }), { status: 201, headers: { "Content-Type": "application/json" } }); }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      renderWithProviders(<Studio />, { client: seed() });
      fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "a grouped column chart" } });
      fireEvent.click(screen.getByTestId("studio-generate"));
      await waitFor(() => expect(screen.getByTestId("studio-submit")).not.toBeDisabled());
      fireEvent.click(screen.getByTestId("studio-submit"));
      await waitFor(() => expect(importBody).toBeTruthy());
      expect(importBody).toMatchObject({ kind: "primitive", storage: "user", name: "Grouped columns" });
    } finally { globalThis.fetch = orig; }
  });

  it("shows validation errors and keeps submit disabled for an invalid primitive", async () => {
    mockFetchRouter({ "POST /api/studio/primitive": { ok: true, body: { result: invalidResult } } });
    renderWithProviders(<Studio />, { client: seed() });
    fireEvent.change(screen.getByTestId("studio-description"), { target: { value: "something vague" } });
    fireEvent.click(screen.getByTestId("studio-generate"));
    await waitFor(() => expect(screen.getByTestId("studio-errors")).toBeInTheDocument());
    expect(screen.getByTestId("studio-errors")).toHaveTextContent(/kebab-case/);
    expect(screen.getByTestId("studio-submit")).toBeDisabled();
  });
});
