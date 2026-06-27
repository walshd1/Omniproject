import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ScreenRenderer } from "./ScreenRenderer";
import type { ScreenDef } from "../../lib/screen";

/**
 * Drag-to-rearrange: in editable mode, dragging one panel onto another emits the new
 * order via onLayoutChange (which the caller persists to the customer's config).
 */
const s: ScreenDef = {
  id: "rep", label: "Report",
  panels: [
    { id: "a", kind: "metric", title: "A", config: { value: 1 } },
    { id: "b", kind: "metric", title: "B", config: { value: 2 } },
    { id: "c", kind: "metric", title: "C", config: { value: 3 } },
  ],
};

describe("ScreenRenderer drag-to-rearrange", () => {
  it("panels are not draggable unless editable", () => {
    renderWithProviders(<ScreenRenderer screen={s} />);
    expect(screen.getByTestId("panel-wrap-a")).not.toHaveAttribute("draggable", "true");
  });

  it("emits the reordered layout when a panel is dragged onto another", () => {
    const onLayoutChange = vi.fn();
    renderWithProviders(<ScreenRenderer screen={s} editable onLayoutChange={onLayoutChange} />);
    const a = screen.getByTestId("panel-wrap-a");
    const c = screen.getByTestId("panel-wrap-c");
    expect(a).toHaveAttribute("draggable", "true");
    // drag C onto A → C should land before A
    fireEvent.dragStart(c);
    fireEvent.dragOver(a);
    fireEvent.drop(a);
    expect(onLayoutChange).toHaveBeenCalledWith({ order: ["c", "a", "b"] });
  });

  it("renders a saved layout in its arranged order", () => {
    renderWithProviders(<ScreenRenderer screen={s} layout={{ order: ["c", "b", "a"] }} />);
    const wraps = screen.getAllByTestId(/^panel-wrap-/).map((el) => el.getAttribute("data-testid"));
    expect(wraps).toEqual(["panel-wrap-c", "panel-wrap-b", "panel-wrap-a"]);
  });
});
