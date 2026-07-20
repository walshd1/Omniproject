import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScreenEditor } from "./ScreenEditor";
import type { OrgScreenDef } from "../../lib/org-screens";

/**
 * The visual screen builder: edits the shell + panel list and emits a JSON screen def. These cover the
 * add-panel + kind-specific config + emit path (a chart panel wired to a source), and the raw-JSON escape.
 */
const base: OrgScreenDef = { id: "s1", label: "Screen One", panels: [{ id: "p1", kind: "table" }] } as OrgScreenDef;

describe("ScreenEditor", () => {
  it("emits the edited def: add a chart panel with a source + type", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={base} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("screen-editor-label"), { target: { value: "My Screen" } });
    fireEvent.click(screen.getByTestId("screen-editor-add-panel")); // adds panel index 1 (kind table)
    fireEvent.change(screen.getByTestId("panel-kind-1"), { target: { value: "chart" } });
    fireEvent.change(screen.getByTestId("panel-source-1"), { target: { value: "/api/budget-plans/rows?groupBy=year&metric=sum:amount" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));

    expect(onSave).toHaveBeenCalledTimes(1);
    const def = onSave.mock.calls[0]![0] as { label: string; panels: Array<{ id: string; kind: string; source?: { url: string } }> };
    expect(def.label).toBe("My Screen");
    expect(def.panels).toHaveLength(2);
    const chart = def.panels[1]!;
    expect(chart.kind).toBe("chart");
    expect(chart.source!.url).toContain("/api/budget-plans/rows");
  });

  it("disables Save when the label is empty", () => {
    render(<ScreenEditor def={{ id: "s1", label: "", panels: [] } as OrgScreenDef} onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByTestId("screen-editor-save")).toBeDisabled();
  });

  it("only shows the route field for non-core screens (allowRoute)", () => {
    const { rerender } = render(<ScreenEditor def={base} onSave={vi.fn()} onCancel={() => {}} allowRoute />);
    expect(screen.getByTestId("screen-editor-route")).toBeInTheDocument();
    rerender(<ScreenEditor def={base} onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByTestId("screen-editor-route")).toBeNull();
  });

  it("has a raw-JSON escape hatch that round-trips into the form", () => {
    render(<ScreenEditor def={base} onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId("screen-editor-raw-toggle"));
    expect(screen.getByTestId("screen-editor-json")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("screen-editor-json"), { target: { value: JSON.stringify({ id: "s1", label: "Via JSON", panels: [] }) } });
    fireEvent.click(screen.getByTestId("screen-editor-apply-json"));
    expect((screen.getByTestId("screen-editor-label") as HTMLInputElement).value).toBe("Via JSON");
  });
});
