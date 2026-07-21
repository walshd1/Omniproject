import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Panel } from "../../../lib/screen";

/** WidgetPanel hosts a dashboard widget by type via the shared WidgetView. */
vi.mock("../../dashboard/widgets", () => ({
  WidgetView: ({ type }: { type: string }) => <div data-testid="widget-view">widget:{type}</div>,
}));

const { WidgetPanel } = await import("./WidgetPanel");

describe("WidgetPanel", () => {
  it("renders the widget for its configured type", () => {
    const panel: Panel = { id: "w", kind: "widget", config: { type: "portfolioHealth" } };
    render(<WidgetPanel panel={panel} />);
    expect(screen.getByTestId("widget-panel-portfolioHealth")).toBeTruthy();
    expect(screen.getByTestId("widget-view").textContent).toContain("portfolioHealth");
  });
});
