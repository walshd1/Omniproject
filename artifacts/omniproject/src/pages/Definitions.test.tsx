import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter } from "../test/utils";
import { defsKey, defKey, type StoredDefMeta } from "../lib/defs";
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
});
