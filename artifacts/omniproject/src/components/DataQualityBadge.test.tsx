import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataQualityBadge } from "./DataQualityBadge";
import { useDataQuality } from "../lib/data-quality";

describe("DataQualityBadge", () => {
  beforeEach(() => useDataQuality.setState({ everRepaired: false, lastRepaired: 0 }));

  it("renders nothing while the backend data is clean", () => {
    render(<DataQualityBadge />);
    expect(screen.queryByTestId("data-quality-badge")).toBeNull();
  });

  it("appears once the gateway has reported a repair, with the count in the tooltip", () => {
    useDataQuality.getState().note(4);
    render(<DataQualityBadge />);
    const badge = screen.getByTestId("data-quality-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute("title")).toContain("4");
  });
});
