import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithProviders, mockBlobDownload } from "../test/utils";
import { Explore } from "./Explore";
import { markExplorationClean, markExplorationDirty } from "../lib/exploration";
import { createSnapshot, saveSnapshots } from "../lib/snapshots";
import { saveEdges, type DependencyEdge } from "../lib/dependencies";

const edge: DependencyEdge = {
  schema: 1,
  edgeKey: "edge-1",
  from: { system: "jira", projectRef: "PROJ", itemRef: "PROJ-1" },
  to: { system: "jira", projectRef: "PROJ", itemRef: "PROJ-2" },
  type: "blocks",
  fromHash: "abc",
  toHash: "def",
  assertedAt: "2024-01-01T00:00:00.000Z",
};

const originalPath = window.location.pathname;

beforeEach(() => {
  window.sessionStorage.clear();
  markExplorationClean();
});

afterEach(() => {
  window.history.pushState({}, "", originalPath); // undo any Exit-to-live navigation
});

describe("Explore mode", () => {
  it("renders an unmistakable NOT-LIVE exploration shell with exit + pop-out", () => {
    renderWithProviders(<Explore />);
    expect(screen.getByTestId("explore-mode")).toBeInTheDocument();
    expect(screen.getByText(/not live data/i)).toBeInTheDocument();
    expect(screen.getByTestId("explore-exit")).toBeInTheDocument();
    expect(screen.getByTestId("explore-popout")).toBeInTheDocument();
  });

  it("hosts the three exploration tools", () => {
    renderWithProviders(<Explore />);
    expect(screen.getByRole("heading", { name: /portfolio trends/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what-if scenario sandbox/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /cross-system dependencies/i })).toBeInTheDocument();
  });

  it("hides the unsaved-work banner when there is no undownloaded work", () => {
    renderWithProviders(<Explore />);
    expect(screen.queryByTestId("explore-unsaved")).not.toBeInTheDocument();
    expect(screen.queryByTestId("explore-download")).not.toBeInTheDocument();
  });

  it("shows the unsaved-work banner + download when exploration work exists", () => {
    markExplorationDirty(); // staged before render → initial state reflects it
    renderWithProviders(<Explore />);
    expect(screen.getByTestId("explore-unsaved")).toBeInTheDocument();
    expect(screen.getByTestId("explore-download")).toBeInTheDocument();
  });

  it("downloads staged snapshots and dependency edges, then marks the session clean", () => {
    saveSnapshots([createSnapshot({}, "2024-01-01T00:00:00.000Z")]);
    saveEdges([edge]);
    markExplorationDirty();
    const { click, restore } = mockBlobDownload();
    try {
      renderWithProviders(<Explore />);
      fireEvent.click(screen.getByTestId("explore-download"));
      expect(click).toHaveBeenCalledTimes(2); // one file per snapshot bundle + one per edge bundle
      expect(screen.queryByTestId("explore-unsaved")).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("still marks the session clean when the download button fires with nothing staged", () => {
    // Dirty here comes from elsewhere in exploration (e.g. the replica workbench's own overlay
    // state), not from snapshots/edges — downloadExploration() marks clean unconditionally.
    markExplorationDirty();
    renderWithProviders(<Explore />);
    fireEvent.click(screen.getByTestId("explore-download"));
    expect(screen.queryByTestId("explore-unsaved")).not.toBeInTheDocument();
  });

  it("pops the exploration out into its own window", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithProviders(<Explore />);
    fireEvent.click(screen.getByTestId("explore-popout"));
    expect(openSpy).toHaveBeenCalledWith(window.location.href, "omni-explore", "width=1280,height=900,noopener");
    openSpy.mockRestore();
  });

  it("exits to /reports", () => {
    renderWithProviders(<Explore />);
    fireEvent.click(screen.getByTestId("explore-exit"));
    expect(window.location.pathname).toBe("/reports");
  });

  it("warns before leaving the tab while there is undownloaded work", () => {
    markExplorationDirty();
    renderWithProviders(<Explore />);
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("reacts to a dirty-state change that happens after mount (e.g. from the replica workbench)", () => {
    renderWithProviders(<Explore />);
    expect(screen.queryByTestId("explore-unsaved")).not.toBeInTheDocument();
    act(() => markExplorationDirty());
    expect(screen.getByTestId("explore-unsaved")).toBeInTheDocument();
  });
});
