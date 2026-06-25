import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("renders the default LOADING… label", () => {
    renderWithProviders(<LoadingState />);
    expect(screen.getByText("LOADING…")).toBeInTheDocument();
  });

  it("renders a custom label", () => {
    renderWithProviders(<LoadingState label="FETCHING DATA" />);
    expect(screen.getByText("FETCHING DATA")).toBeInTheDocument();
  });

  it("applies a custom className wrapper", () => {
    renderWithProviders(<LoadingState label="WAIT" className="my-wrapper" />);
    expect(screen.getByText("WAIT")).toHaveClass("my-wrapper");
  });
});
