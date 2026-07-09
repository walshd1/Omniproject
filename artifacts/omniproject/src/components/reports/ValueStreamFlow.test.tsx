import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, getGetFxRatesQueryKey, type Project, type Issue, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ValueStreamFlow, rollupValueStreams, flowState, parseDateMs } from "./ValueStreamFlow";
import type { ProjectItems } from "../../lib/portfolio-value";

const FX: FxRates = { base: "GBP", rates: { GBP: 1 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;
const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
// Flow fields include the registry passthrough valueStream not on the typed Issue, so the factory takes a
// loose record and casts.
const issue = (o: Record<string, unknown> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...o } as unknown as Issue);

function seed(projects: Project[], issues: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, list] of Object.entries(issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  return qc;
}

const NOW = Date.parse("2026-07-09T00:00:00Z");
const items = (list: Record<string, unknown>[]): ProjectItems => ({ projectId: "a", projectName: "A", programmeId: null, programmeName: null, currency: "GBP", items: list as unknown as ProjectItems["items"] });

describe("flowState", () => {
  it("buckets free-form status into wip / done / other", () => {
    expect(flowState("in_progress")).toBe("wip");
    expect(flowState("In Review")).toBe("wip");
    expect(flowState("Doing")).toBe("wip");
    expect(flowState("done")).toBe("done");
    expect(flowState("Closed")).toBe("done");
    expect(flowState("resolved")).toBe("done");
    expect(flowState("todo")).toBe("other");
    expect(flowState("backlog")).toBe("other");
    expect(flowState("cancelled")).toBe("other");
    expect(flowState(null)).toBe("other");
    expect(flowState("")).toBe("other");
  });
});

describe("parseDateMs", () => {
  it("parses valid dates and returns null (never NaN) for junk or absent values", () => {
    expect(parseDateMs("2026-07-01T00:00:00Z")).toBe(Date.parse("2026-07-01T00:00:00Z"));
    expect(parseDateMs(null)).toBeNull();
    expect(parseDateMs(undefined)).toBeNull();
    expect(parseDateMs("not-a-date")).toBeNull();
    expect(parseDateMs("")).toBeNull();
  });
});

describe("rollupValueStreams", () => {
  it("groups by value stream and derives WIP, load, aging, throughput and cycle time", () => {
    const roll = rollupValueStreams(
      [
        items([
          // Checkout: 2 in-flight (one aging), 1 recently done.
          { id: "a", valueStream: "Checkout", status: "in_progress", startDate: "2026-07-01T00:00:00Z", storyPoints: 5 },
          { id: "b", valueStream: "Checkout", status: "in_review", createdAt: "2026-06-20T00:00:00Z", storyPoints: 3 },
          { id: "c", valueStream: "Checkout", status: "done", createdAt: "2026-06-25T00:00:00Z", updatedAt: "2026-07-05T00:00:00Z" },
          // Fulfilment: nothing in flight, one done long ago (outside the throughput window).
          { id: "d", valueStream: "Fulfilment", status: "done", createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-20T00:00:00Z" },
          { id: "e", valueStream: "Fulfilment", status: "todo" },
        ]),
      ],
      { now: NOW },
    );

    expect(roll.streams).toHaveLength(2);
    // Most WIP first → Checkout (2) before Fulfilment (0).
    const co = roll.streams[0]!;
    expect(co.key).toBe("checkout");
    expect(co.items).toBe(3);
    expect(co.wip).toBe(2);
    expect(co.flowLoad).toBe(8); // 5 + 3
    expect(co.done).toBe(1);
    expect(co.throughput).toBe(1); // done 4 days ago, inside 30d window
    expect(co.meanAge).toBe(13.5); // (8 + 19) / 2
    expect(co.maxAge).toBe(19);
    expect(co.agingOver).toBe(1); // the 19-day item is > 14
    expect(co.meanCycle).toBe(10); // 2026-06-25 → 2026-07-05

    const fu = roll.streams[1]!;
    expect(fu.wip).toBe(0);
    expect(fu.throughput).toBe(0); // done in May, outside 30d window
    expect(fu.meanAge).toBeNull();
    expect(fu.agingOver).toBe(0);
    expect(fu.meanCycle).toBe(19); // 2026-05-01 → 2026-05-20

    expect(roll.totals).toMatchObject({ streams: 2, items: 5, wip: 2, throughput: 1, agingOver: 1, meanCycle: 14.5 });
  });

  it("falls back to the first label, then Unassigned", () => {
    const roll = rollupValueStreams(
      [items([
        { id: "1", labels: ["Payments"], status: "in_progress", startDate: "2026-07-05T00:00:00Z" },
        { id: "2", status: "todo" },
      ])],
      { now: NOW },
    );
    expect(roll.streams.map((s) => s.key).sort()).toEqual(["payments", "unassigned"]);
  });

  it("never emits NaN when every date is unparseable — bad dates are skipped, not surfaced", () => {
    const roll = rollupValueStreams(
      [items([
        { id: "1", valueStream: "Broken", status: "in_progress", startDate: "not-a-date", createdAt: "garbage", storyPoints: 4 },
        { id: "2", valueStream: "Broken", status: "done", createdAt: "???", updatedAt: "nope" },
      ])],
      { now: NOW },
    );
    const row = roll.streams[0]!;
    // In-flight item counts toward WIP/load, but its unparseable dates yield no age.
    expect(row.wip).toBe(1);
    expect(row.flowLoad).toBe(4);
    expect(row.done).toBe(1);
    expect(row.meanAge).toBeNull();
    expect(row.maxAge).toBeNull();
    expect(row.agingOver).toBe(0);
    expect(row.throughput).toBe(0);
    expect(row.meanCycle).toBeNull();
    // Assert nothing numeric anywhere in the roll-up came out NaN.
    for (const v of JSON.stringify(roll).match(/-?\d+(\.\d+)?/g) ?? []) expect(Number.isNaN(Number(v))).toBe(false);
    for (const r of roll.streams) for (const val of Object.values(r)) if (typeof val === "number") expect(Number.isFinite(val)).toBe(true);
    expect(Number.isNaN(roll.totals.meanCycle as number)).toBe(false);
  });

  it("clamps a backwards span (updated before created) to zero rather than a negative cycle", () => {
    const roll = rollupValueStreams(
      [items([{ id: "1", valueStream: "Odd", status: "done", createdAt: "2026-07-05T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z" }])],
      { now: NOW },
    );
    expect(roll.streams[0]!.meanCycle).toBe(0);
  });
});

describe("ValueStreamFlow", () => {
  it("renders the per-value-stream flow roll-up", () => {
    renderWithProviders(<ValueStreamFlow />, {
      client: seed([project({ id: "a" })], {
        a: [
          issue({ id: "1", valueStream: "Checkout", status: "in_progress", startDate: "2026-07-01T00:00:00Z", storyPoints: 5 }),
          issue({ id: "2", valueStream: "Fulfilment", status: "done", createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-10T00:00:00Z" }),
        ],
      }),
    });
    expect(screen.getByTestId("value-stream-flow")).toBeInTheDocument();
    expect(screen.getByTestId("value-stream-flow-row-checkout")).toBeInTheDocument();
    expect(screen.getByTestId("value-stream-flow-row-fulfilment")).toBeInTheDocument();
  });

  it("shows the empty state when no work items load", () => {
    renderWithProviders(<ValueStreamFlow />, { client: seed([project({ id: "a" })], { a: [] }) });
    expect(screen.getByTestId("value-stream-flow-empty")).toBeInTheDocument();
  });
});
