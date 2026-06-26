import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/utils";
import { DataProvenance } from "./DataProvenance";

let clickSpy: ReturnType<typeof vi.spyOn>;
const hrefs: string[] = [];

beforeEach(() => {
  hrefs.length = 0;
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    hrefs.push(this.href);
  });
});
afterEach(() => clickSpy.mockRestore());

const ROWS = [
  { id: "1", budget: 100, dueDate: "2026-07-01", source: "jira" },
  { id: "2", budget: 0, dueDate: null, source: "jira" },
  { id: "3", budget: null, dueDate: null, source: "openproject" },
];
const FIELDS = [
  { key: "budget", label: "Budget" },
  { key: "dueDate", label: "Due date" },
];

describe("DataProvenance", () => {
  it("shows overall completeness on the trigger chip", () => {
    renderWithProviders(<DataProvenance rows={ROWS} fields={FIELDS} filename="x" />);
    // budget present 2/3, dueDate present 1/3 → 3 of 6 cells = 50%
    expect(screen.getByTestId("data-completeness")).toHaveTextContent("50%");
  });

  it("opens to reveal per-field fill and the source breakdown", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataProvenance rows={ROWS} fields={FIELDS} mode="n8n" filename="x" />);
    await user.click(screen.getByTestId("data-provenance"));
    // dueDate is the sparsest (1/3) — listed with its fill
    expect(await screen.findByTestId("field-dueDate")).toHaveTextContent("1/3");
    expect(screen.getByTestId("field-budget")).toHaveTextContent("2/3");
    // sources grouped, jira (2) + openproject (1)
    expect(within(screen.getByTestId("source-jira")).getByText("2")).toBeInTheDocument();
    expect(screen.getByTestId("source-openproject")).toBeInTheDocument();
  });

  it("shows granular per-field lineage and the poll time", async () => {
    const user = userEvent.setup();
    const polledAt = Date.now() - 30_000; // 30s ago
    renderWithProviders(
      <DataProvenance rows={ROWS} fields={FIELDS} mode="jira" filename="x" polledAt={polledAt}
        fieldSources={{ dueDate: { system: "jira", field: "duedate" }, budget: { system: "jira", field: "customfield_10100" } }} />,
    );
    await user.click(screen.getByTestId("data-provenance"));
    expect(await screen.findByTestId("lineage-dueDate")).toHaveTextContent("jira:duedate");
    expect(screen.getByTestId("lineage-budget")).toHaveTextContent("jira:customfield_10100");
    // freshness ("polled … ago") is shown
    expect(screen.getByTestId("polled-at")).toHaveTextContent(/polled .*ago/);
  });

  it("exports the on-screen rows as CSV with lineage columns", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataProvenance rows={ROWS} fields={FIELDS} filename="issues" />);
    await user.click(screen.getByTestId("data-provenance"));
    await user.click(await screen.findByTestId("export-csv"));
    expect(hrefs).toHaveLength(1);
    const csv = decodeURIComponent(hrefs[0]!.replace(/^data:text\/csv;charset=utf-8,/, ""));
    // header carries the measured fields PLUS the lineage columns
    expect(csv.split("\n")[0]).toBe("Budget,Due date,id,source,provenance,lastUpdatedBy");
    expect(csv).toContain("jira");
    expect(csv).toContain("openproject");
  });

  it("exports JSON of the on-screen rows", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataProvenance rows={ROWS} fields={FIELDS} filename="issues" />);
    await user.click(screen.getByTestId("data-provenance"));
    await user.click(await screen.findByTestId("export-json"));
    const json = decodeURIComponent(hrefs[0]!.replace(/^data:application\/json;charset=utf-8,/, ""));
    expect(JSON.parse(json)).toHaveLength(3);
  });
});
