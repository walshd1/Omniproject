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

  it("surfaces the primitive library (what you can build from) — degrades gracefully with no query client", () => {
    // Rendered without a QueryClientProvider: the library still shows the shipped vocabulary (activated primitives
    // just aren't fetched), rather than crashing the editor.
    render(<ScreenEditor def={base} onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByTestId("primitive-library")).toBeInTheDocument();
    expect(screen.getByTestId("primitive-library-item-viz-bar")).toBeInTheDocument();
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

  it("surfaces an error for invalid raw JSON and can go back to the form", () => {
    render(<ScreenEditor def={base} onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId("screen-editor-raw-toggle"));
    // Not an object with a panels array → the applyRaw catch shows an error.
    fireEvent.change(screen.getByTestId("screen-editor-json"), { target: { value: JSON.stringify({ id: "s1", label: "x" }) } });
    fireEvent.click(screen.getByTestId("screen-editor-apply-json"));
    expect(screen.getByTestId("screen-editor-error")).toBeInTheDocument();
    // "Back to form" returns to the structured editor without applying.
    fireEvent.click(screen.getByText("Back to form"));
    expect(screen.getByTestId("screen-editor")).toBeInTheDocument();
  });

  it("invokes onCancel from the Cancel button", () => {
    const onCancel = vi.fn();
    render(<ScreenEditor def={base} onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a Saving… label and disables save while saving", () => {
    render(<ScreenEditor def={base} onSave={vi.fn()} onCancel={() => {}} saving />);
    const save = screen.getByTestId("screen-editor-save");
    expect(save).toBeDisabled();
    expect(save).toHaveTextContent("Saving…");
  });

  it("edits the shell fields — route, full-bleed, methodologies — and emits them", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={base} onSave={onSave} onCancel={() => {}} allowRoute />);
    fireEvent.change(screen.getByTestId("screen-editor-route"), { target: { value: "/my-screen" } });
    fireEvent.click(screen.getByTestId("screen-editor-bare"));
    fireEvent.change(screen.getByTestId("screen-editor-methodologies"), { target: { value: "kanban, scrum" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    const def = onSave.mock.calls[0]![0] as { route: string; bare: boolean; methodologies: string[] };
    expect(def.route).toBe("/my-screen");
    expect(def.bare).toBe(true);
    expect(def.methodologies).toEqual(["kanban", "scrum"]);
  });

  it("edits a panel's id, title and span", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={base} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("panel-id-0"), { target: { value: "hero" } });
    fireEvent.change(screen.getByLabelText("Panel 1 title"), { target: { value: "Overview" } });
    fireEvent.change(screen.getByLabelText("Panel 1 span"), { target: { value: "6" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    const panel = (onSave.mock.calls[0]![0] as { panels: Array<{ id: string; title: string; span: number }> }).panels[0]!;
    expect(panel).toMatchObject({ id: "hero", title: "Overview", span: 6 });
  });

  it("clears a numeric span back to undefined when emptied", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={{ id: "s1", label: "S", panels: [{ id: "p1", kind: "table", span: 4 }] } as OrgScreenDef} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Panel 1 span"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    expect((onSave.mock.calls[0]![0] as { panels: Array<{ span?: number }> }).panels[0]!.span).toBeUndefined();
  });

  it("configures a full chart panel — type, x field and series", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={base} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("panel-kind-0"), { target: { value: "chart" } });
    fireEvent.change(screen.getByLabelText("Panel 1 chart type"), { target: { value: "line" } });
    fireEvent.change(screen.getByLabelText("Panel 1 x"), { target: { value: "year" } });
    fireEvent.change(screen.getByLabelText("Panel 1 series"), { target: { value: "amount, forecast" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    const cfg = (onSave.mock.calls[0]![0] as { panels: Array<{ config: { chartType: string; xKey: string; series: Array<{ key: string; label: string }> } }> }).panels[0]!.config;
    expect(cfg.chartType).toBe("line");
    expect(cfg.xKey).toBe("year");
    expect(cfg.series).toEqual([{ key: "amount", label: "amount" }, { key: "forecast", label: "forecast" }]);
  });

  it("clears the source when the URL is emptied", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={{ id: "s1", label: "S", panels: [{ id: "p1", kind: "table", source: { url: "/api/x" } }] } as OrgScreenDef} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("panel-source-0"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    expect((onSave.mock.calls[0]![0] as { panels: Array<{ source?: unknown }> }).panels[0]!.source).toBeUndefined();
  });

  it("picks a board for a view panel and a page for a component panel", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={{ id: "s1", label: "S", panels: [{ id: "v", kind: "view" }, { id: "c", kind: "component" }] } as OrgScreenDef} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("panel-view-0"), { target: { value: "kanban" } });
    const componentSelect = screen.getByTestId("panel-component-1") as HTMLSelectElement;
    const firstComponent = componentSelect.querySelectorAll("option")[1]!.getAttribute("value")!;
    fireEvent.change(componentSelect, { target: { value: firstComponent } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    const panels = (onSave.mock.calls[0]![0] as { panels: Array<{ config: Record<string, unknown> }> }).panels;
    expect(panels[0]!.config.view).toBe("kanban");
    expect(panels[1]!.config.component).toBe(firstComponent);
  });

  it("edits prose for a text panel", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={{ id: "s1", label: "S", panels: [{ id: "t", kind: "text" }] } as OrgScreenDef} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Panel 1 text"), { target: { value: "Guidance here" } });
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    expect((onSave.mock.calls[0]![0] as { panels: Array<{ config: { text: string } }> }).panels[0]!.config.text).toBe("Guidance here");
  });

  it("adds, reorders and removes panels", () => {
    const onSave = vi.fn();
    render(<ScreenEditor def={{ id: "s1", label: "S", panels: [{ id: "a", kind: "table" }] } as OrgScreenDef} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByTestId("screen-editor-add-panel")); // adds panel index 1
    fireEvent.change(screen.getByTestId("panel-id-1"), { target: { value: "b" } });
    // Moving the first panel up is a no-op; move panel 2 up so b leads.
    fireEvent.click(screen.getByLabelText("Move panel 1 up"));
    fireEvent.click(screen.getByLabelText("Move panel 2 up"));
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    let panels = (onSave.mock.calls.at(-1)![0] as { panels: Array<{ id: string }> }).panels;
    expect(panels.map((p) => p.id)).toEqual(["b", "a"]);
    // Move it back down, then remove the first panel.
    fireEvent.click(screen.getByLabelText("Move panel 1 down"));
    fireEvent.click(screen.getByTestId("panel-remove-0"));
    fireEvent.click(screen.getByTestId("screen-editor-save"));
    panels = (onSave.mock.calls.at(-1)![0] as { panels: Array<{ id: string }> }).panels;
    expect(panels.map((p) => p.id)).toEqual(["b"]);
  });

  it("flags duplicate/blank panel ids and blocks save", () => {
    render(<ScreenEditor def={{ id: "s1", label: "S", panels: [{ id: "dup", kind: "table" }, { id: "dup", kind: "table" }] } as OrgScreenDef} onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByTestId("screen-editor-save")).toBeDisabled();
    expect(screen.getByTestId("panel-editor-1").className).toContain("border-red-500/50");
  });

  it("keeps an unknown (config-folder) panel kind selectable rather than dropping it", () => {
    render(<ScreenEditor def={{ id: "s1", label: "S", panels: [{ id: "p", kind: "custom-widget" }] } as OrgScreenDef} onSave={vi.fn()} onCancel={() => {}} />);
    const kindSelect = screen.getByTestId("panel-kind-0") as HTMLSelectElement;
    const values = Array.from(kindSelect.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).toContain("custom-widget");
    expect(kindSelect.value).toBe("custom-widget");
  });
});
