import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { getComponent, type LibraryComponent } from "@workspace/backend-catalogue";
import { getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { LibraryComponentView } from "./LibraryComponentView";

afterEach(() => vi.restoreAllMocks());

describe("LibraryComponentView", () => {
  it("renders a resolvable widget component", () => {
    const widget = getComponent("widget:projectCount")!;
    const { queryClient } = renderWithProviders(<LibraryComponentView component={widget} />);
    queryClient.setQueryData(getListProjectsQueryKey(), [{ id: "p1" }] as Project[]);
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("shows an honest placeholder for a surfaced-via report (no inline renderer)", () => {
    const gantt = getComponent("report:gantt")!;
    renderWithProviders(<LibraryComponentView component={gantt} />);
    expect(screen.getByTestId(`library-component-unavailable-${gantt.id}`)).toHaveTextContent(/surfaced via view/i);
  });

  it("polls active queries on the component's declared refresh interval", () => {
    vi.useFakeTimers();
    try {
      // portfolioHealth.json declares refresh: 60 (seconds).
      const health = getComponent("widget:portfolioHealth")!;
      expect(health.refresh).toBe(60);
      const { queryClient } = renderWithProviders(<LibraryComponentView component={health} />);
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      vi.advanceTimersByTime(60_000);
      expect(spy).toHaveBeenCalledWith({ refetchType: "active" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never polls when the component declares no refresh", () => {
    vi.useFakeTimers();
    try {
      const evm = getComponent("report:evm")!;
      expect(evm.refresh).toBeUndefined();
      const { queryClient } = renderWithProviders(<LibraryComponentView component={evm as LibraryComponent} projectId="p1" />);
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      vi.advanceTimersByTime(600_000);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
