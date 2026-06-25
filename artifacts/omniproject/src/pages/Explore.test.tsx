import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { Explore } from "./Explore";
import { markExplorationClean, markExplorationDirty } from "../lib/exploration";

beforeEach(() => {
  window.sessionStorage.clear();
  markExplorationClean();
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
});
