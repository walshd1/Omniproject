import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { visibleGridColumns, coerceCellValue, buildIssueUpdate, GRID_COLUMNS, IssueGrid } from "./IssueGrid";
import { availabilityQueryKey, type Availability } from "../../lib/availability";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";
import { savedViewsQueryKey } from "../../lib/saved-views";

describe("IssueGrid helpers", () => {
  it("visibleGridColumns gates columns by availability.fields", () => {
    const avail: Availability = {
      source: "capabilities",
      fields: ["title", "status"],
      available: ["title", "status", "dueDate"],
      hidden: ["dueDate"],
      tables: [],
      relationships: [],
    };
    expect(visibleGridColumns(avail).map((c) => c.field)).toEqual(["title", "status"]);
  });

  it("visibleGridColumns shows all columns while availability is still loading", () => {
    expect(visibleGridColumns(undefined).length).toBe(GRID_COLUMNS.length);
  });

  it("coerceCellValue types values and maps empty to null", () => {
    expect(coerceCellValue("number", "5")).toBe(5);
    expect(coerceCellValue("number", "")).toBe(null);
    expect(coerceCellValue("date", "")).toBe(null);
    expect(coerceCellValue("date", "2026-01-02")).toBe("2026-01-02");
    expect(coerceCellValue("text", "  hi  ")).toBe("hi");
  });

  it("buildIssueUpdate binds expectedVersion only when a version is present", () => {
    expect(buildIssueUpdate("status", "done", 3)).toEqual({ status: "done", expectedVersion: 3 });
    expect(buildIssueUpdate("status", "done", null)).toEqual({ status: "done" });
    expect(buildIssueUpdate("storyPoints", 8, undefined)).toEqual({ storyPoints: 8 });
  });
});

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i1", projectId: "p1", title: "Alpha task", status: "todo",
    priority: "medium", assignee: "ada", labels: [], source: "jira", version: 2,
    ...over,
  } as Issue;
}

const AVAIL: Availability = {
  source: "capabilities",
  fields: ["title", "status", "priority", "assignee"],
  available: ["title", "status", "priority", "assignee"],
  hidden: [],
  tables: [],
  relationships: [],
};

let SEEDED: Issue[] = [];

function seed(issues: Issue[], opts: { savedViews?: boolean } = {}): QueryClient {
  SEEDED = issues;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  qc.setQueryData(availabilityQueryKey, AVAIL);
  qc.setQueryData(featuresQueryKey(), [
    { id: "savedViews", kind: "module", label: "Saved views", description: "", enabled: opts.savedViews ?? false, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  qc.setQueryData(savedViewsQueryKey, []);
  return qc;
}

describe("IssueGrid component", () => {
  beforeEach(() => {
    // GET (re)fetches return the seeded issues (stable refetch); mutations return {}.
    // The JSON content-type matters: the generated client parses by content-type, so without it
    // the body comes back as a raw string and the grid would spread it character-by-character.
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts?: RequestInit) => {
      const method = opts?.method ?? "GET";
      const body = method === "GET" ? JSON.stringify(SEEDED) : "{}";
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  const mutatingCalls = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, o]) => o && /PATCH|PUT|POST/.test((o as RequestInit).method ?? ""),
    );

  it("renders a row per issue with availability-gated column headers", () => {
    renderWithProviders(<IssueGrid projectId="p1" />, { client: seed([issue(), issue({ id: "i2", title: "Beta task" })]) });
    expect(screen.getByTestId("grid-table")).toBeInTheDocument();
    for (const label of ["Title", "Status", "Priority", "Assignee"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    // Curated-out columns (Start/Due/Points) are absent.
    expect(screen.queryByRole("button", { name: /^Points/ })).toBeNull();
    expect(screen.getByText("Alpha task")).toBeInTheDocument();
    expect(screen.getByText("Beta task")).toBeInTheDocument();
  });

  it("edits a cell and writes through with the optimistic-concurrency token", async () => {
    const client = seed([issue()]);
    renderWithProviders(<IssueGrid projectId="p1" />, { client });
    fireEvent.click(screen.getByRole("button", { name: "Edit Title for Alpha task" }));
    const input = screen.getByLabelText("Title for Alpha task");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mutatingCalls().length).toBeGreaterThan(0));
    const [, opts] = mutatingCalls().at(-1)!;
    expect(String((opts as RequestInit).body)).toContain("expectedVersion");
    await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  });

  it("closes the editor on Escape", () => {
    renderWithProviders(<IssueGrid projectId="p1" />, { client: seed([issue()]) });
    fireEvent.click(screen.getByRole("button", { name: "Edit Title for Alpha task" }));
    const input = screen.getByLabelText("Title for Alpha task");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Title for Alpha task")).toBeNull();
  });

  it("shows the bulk bar on selection and the field/value pickers reflect the columns", () => {
    renderWithProviders(<IssueGrid projectId="p1" />, { client: seed([issue(), issue({ id: "i2", title: "Beta task" })]) });
    fireEvent.click(screen.getByLabelText("Select Alpha task"));
    fireEvent.click(screen.getByLabelText("Select Beta task"));
    const bulk = screen.getByTestId("bulk-bar");
    expect(within(bulk).getByText("2 selected")).toBeInTheDocument();
    const fieldSelect = within(bulk).getByLabelText("Bulk field") as HTMLSelectElement;
    expect([...fieldSelect.options].map((o) => o.value)).toEqual(["title", "status", "priority", "assignee"]);
    // Deselect clears the bar.
    fireEvent.click(screen.getByLabelText("Select Alpha task"));
    fireEvent.click(screen.getByLabelText("Select Beta task"));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  it("bulk-applies a field value to the selected row (write-through)", async () => {
    const client = seed([issue()]);
    renderWithProviders(<IssueGrid projectId="p1" />, { client });
    fireEvent.click(screen.getByLabelText("Select Alpha task"));
    const bulk = screen.getByTestId("bulk-bar");
    fireEvent.change(within(bulk).getByLabelText("Bulk field"), { target: { value: "status" } });
    fireEvent.change(within(bulk).getByLabelText("Bulk value"), { target: { value: "done" } });
    fireEvent.click(within(bulk).getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(mutatingCalls().length).toBeGreaterThan(0));
    await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0));
  });

  it("toggles sort direction on a column header", () => {
    renderWithProviders(<IssueGrid projectId="p1" />, { client: seed([issue({ title: "B" }), issue({ id: "i2", title: "A" })]) });
    const header = screen.getByRole("button", { name: /^Title/ });
    fireEvent.click(header); // asc
    expect(header).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(header); // desc
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("shows the saved-views bar when the savedViews module is enabled", () => {
    renderWithProviders(<IssueGrid projectId="p1" />, { client: seed([issue()], { savedViews: true }) });
    expect(screen.getByTestId("saved-views-bar")).toBeInTheDocument();
  });
});
