import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { timesheetSourcesQueryKey, timesheetsQueryKey, type TimesheetSources } from "../../lib/timesheets-api";
import type { Timesheet } from "../../lib/timesheet";
import { TimesheetReview } from "./TimesheetReview";

function seed(sources: TimesheetSources, sheets: Timesheet[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: { sub: "u1" }, role: "manager" });
  qc.setQueryData(timesheetSourcesQueryKey, sources);
  qc.setQueryData(timesheetsQueryKey(undefined), sheets);
  return qc;
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }))));
afterEach(resetFetchMock);

describe("TimesheetReview", () => {
  it("explains how to enable timesheets when no source is available", () => {
    renderWithProviders(<TimesheetReview />, { client: seed({ available: false, source: null, selfHostAdopted: false }) });
    expect(screen.getByTestId("timesheets-disabled")).toHaveTextContent(/adopt the self-host database|backend timesheet source/i);
  });

  it("shows the source and an empty state when enabled with no sheets", () => {
    renderWithProviders(<TimesheetReview />, { client: seed({ available: true, source: "self-host", selfHostAdopted: true }, []) });
    expect(screen.getByTestId("timesheet-review")).toHaveTextContent("stored in self-host");
    expect(screen.getByTestId("timesheet-review-empty")).toBeInTheDocument();
  });

  it("renders a panel per sheet when enabled", () => {
    const sheets: Timesheet[] = [{ id: "ts1", resourceId: "u1", weekStart: "2026-01-05", entries: [{ id: "e1", projectId: "p1", date: "2026-01-05", hours: 8 }], status: "draft" }];
    renderWithProviders(<TimesheetReview />, { client: seed({ available: true, source: "backend", selfHostAdopted: false }, sheets) });
    expect(screen.getByTestId("timesheet-panel")).toBeInTheDocument();
    expect(screen.getByTestId("timesheet-total")).toHaveTextContent("8h");
  });
});
