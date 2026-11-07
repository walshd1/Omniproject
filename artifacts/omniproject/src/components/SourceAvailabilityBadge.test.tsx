import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceAvailabilityBadge } from "./SourceAvailabilityBadge";
import { useSourceAvailability } from "../lib/source-availability";

describe("SourceAvailabilityBadge", () => {
  beforeEach(() => useSourceAvailability.setState({ unavailable: 0, at: null }));

  it("renders nothing while every source is answering", () => {
    render(<SourceAvailabilityBadge />);
    expect(screen.queryByTestId("source-availability-badge")).toBeNull();
  });

  it("appears when a source stops answering", () => {
    useSourceAvailability.getState().note(1);
    render(<SourceAvailabilityBadge />);
    expect(screen.getByTestId("source-availability-badge")).toHaveTextContent("1 source down");
  });

  it("pluralises, and explains WHY figures are missing rather than just that they are", () => {
    useSourceAvailability.getState().note(3);
    render(<SourceAvailabilityBadge />);
    const badge = screen.getByTestId("source-availability-badge");
    expect(badge).toHaveTextContent("3 sources down");
    expect(badge.getAttribute("title")).toMatch(/withheld/);
  });

  it("disappears again once the source returns — the signal is self-healing", () => {
    useSourceAvailability.getState().note(2);
    const { rerender } = render(<SourceAvailabilityBadge />);
    expect(screen.getByTestId("source-availability-badge")).toBeInTheDocument();
    useSourceAvailability.getState().note(0);
    rerender(<SourceAvailabilityBadge />);
    expect(screen.queryByTestId("source-availability-badge")).toBeNull();
  });
});
