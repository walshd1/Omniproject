import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { schedulingOrgKey } from "../../lib/scheduling-settings";
import { Toaster } from "../ui/toaster";
import { SchedulingSettingsAdmin } from "./SchedulingSettingsAdmin";

/** The working-time admin card: seeds from GET /api/scheduling (the org config def), edits, PUT /api/scheduling. */
function seed(scheduling: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(schedulingOrgKey, { scheduling });
  return qc;
}

describe("SchedulingSettingsAdmin", () => {
  afterEach(() => resetFetchMock());

  it("seeds the editor from the org config def", async () => {
    renderWithProviders(<SchedulingSettingsAdmin />, {
      client: seed({ hoursPerDay: 7.5, workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] }),
    });
    await waitFor(() => expect(screen.getByTestId("sched-hours")).toHaveValue(7.5));
    expect(screen.getByTestId("sched-day-6")).toHaveAttribute("aria-pressed", "false"); // Sat off
    expect(screen.getByTestId("sched-day-1")).toHaveAttribute("aria-pressed", "true"); // Mon on
    expect(screen.getByTestId("sched-holiday-list")).toHaveTextContent("2026-12-25");
  });

  it("saves an edited working-time config via PUT /api/scheduling", async () => {
    mockFetchRouter({ "/api/scheduling": { ok: true, body: { scheduling: { hoursPerDay: 6, workingWeekdays: [1, 2, 3, 4, 5, 6], holidays: [] } } } });
    renderWithProviders(<><SchedulingSettingsAdmin /><Toaster /></>, {
      client: seed({ hoursPerDay: 8, workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }),
    });
    await waitFor(() => expect(screen.getByTestId("sched-hours")).toHaveValue(8));
    fireEvent.change(screen.getByTestId("sched-hours"), { target: { value: "6" } });
    fireEvent.click(screen.getByTestId("sched-day-6")); // add Saturday
    fireEvent.click(screen.getByTestId("sched-save"));
    expect(await screen.findByText("WORKING TIME SAVED")).toBeInTheDocument();
  });

  it("disables save when no working day is selected", async () => {
    renderWithProviders(<SchedulingSettingsAdmin />, {
      client: seed({ hoursPerDay: 8, workingWeekdays: [1], holidays: [] }),
    });
    await waitFor(() => expect(screen.getByTestId("sched-day-1")).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByTestId("sched-day-1")); // remove the only working day
    expect(screen.getByTestId("sched-save")).toBeDisabled();
  });
});
