import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter } from "../test/utils";
import { defsKey, type StoredDefMeta } from "../lib/defs";
import { Definitions } from "./Definitions";

/** The Definitions (importer) page: list, JSON-parse guard, validate dry-run, and save gating. */
function seed(items: StoredDefMeta[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData([...defsKey, null, null], items);
  return qc;
}
const meta = (over: Partial<StoredDefMeta> = {}): StoredDefMeta => ({
  id: "user~abc", kind: "primitive", name: "My chart", storage: "user",
  createdBy: "cee@x.io", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

afterEach(() => { vi.restoreAllMocks(); });

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
});
