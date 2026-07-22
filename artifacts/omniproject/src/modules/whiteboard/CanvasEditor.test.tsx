import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CanvasElement } from "@workspace/backend-catalogue";
import { CanvasEditor } from "./CanvasEditor";

/** The native canvas editor: tool selection, pointer-create, and the selected-element inspector. */
describe("CanvasEditor", () => {
  it("renders a toolbar with a tool per canvas primitive", () => {
    render(<CanvasEditor elements={[]} onChange={() => {}} />);
    for (const t of ["select", "sticky", "shape", "text", "connector", "pen", "frame"]) {
      expect(screen.getByTestId(`canvas-tool-${t}`)).toBeInTheDocument();
    }
  });

  it("creates a sticky on pointer-down when the sticky tool is active", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("canvas-tool-sticky"));
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 40, clientY: 30, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0]![0];
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: "sticky", color: "yellow" });
  });

  it("shows an inspector for a selected element and can edit its text + delete it", () => {
    const els: CanvasElement[] = [{ id: "s1", type: "sticky", x: 10, y: 10, w: 120, h: 80, text: "hi" }];
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={els} onChange={onChange} />);
    // Select tool is default; pointer-down over the sticky (bounds 10..130 x, 10..90 y) selects it.
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 20, clientY: 20, pointerId: 1 });
    const text = screen.getByTestId("canvas-text") as HTMLInputElement;
    expect(text.value).toBe("hi");
    fireEvent.change(text, { target: { value: "cutover" } });
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({ id: "s1", text: "cutover" });

    fireEvent.click(screen.getByTestId("canvas-delete"));
    expect(onChange.mock.calls.at(-1)![0]).toEqual([]);
  });

  it("offers 'Create work item' on a selected sticky and calls back with it", () => {
    const els: CanvasElement[] = [{ id: "s1", type: "sticky", x: 10, y: 10, w: 120, h: 80, text: "Cutover" }];
    const onConvertSticky = vi.fn<(el: CanvasElement) => void>();
    render(<CanvasEditor elements={els} onChange={() => {}} onConvertSticky={onConvertSticky} />);
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.click(screen.getByTestId("canvas-to-issue"));
    expect(onConvertSticky).toHaveBeenCalledTimes(1);
    expect(onConvertSticky.mock.calls[0]![0]).toMatchObject({ id: "s1", text: "Cutover" });
  });

  it("disables 'Create work item' for a sticky with no text", () => {
    const els: CanvasElement[] = [{ id: "s1", type: "sticky", x: 10, y: 10, w: 120, h: 80, text: "" }];
    render(<CanvasEditor elements={els} onChange={() => {}} onConvertSticky={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 20, clientY: 20, pointerId: 1 });
    expect(screen.getByTestId("canvas-to-issue")).toBeDisabled();
  });

  it("draws other users' live cursors from the cursors prop", () => {
    const cursors = [{ cid: "peer1", label: "Grace", color: "#e11", x: 50, y: 60, at: Date.now() }];
    render(<CanvasEditor elements={[]} onChange={() => {}} cursors={cursors} />);
    const cursor = screen.getByTestId("canvas-cursor-peer1");
    expect(cursor).toBeInTheDocument();
    expect(cursor).toHaveTextContent("Grace");
  });

  it("publishes the pointer position on move over the surface", () => {
    const onCursorMove = vi.fn<(x: number, y: number) => void>();
    render(<CanvasEditor elements={[]} onChange={() => {}} onCursorMove={onCursorMove} />);
    fireEvent.pointerMove(screen.getByTestId("canvas-surface"), { clientX: 42, clientY: 24, pointerId: 1 });
    expect(onCursorMove).toHaveBeenCalledWith(42, 24);
  });

  it("hides the toolbar and inspector in read-only mode and ignores pointer input", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    const els: CanvasElement[] = [{ id: "s1", type: "sticky", x: 10, y: 10, w: 120, h: 80, text: "hi" }];
    render(<CanvasEditor elements={els} onChange={onChange} readOnly />);
    expect(screen.queryByTestId("canvas-toolbar")).toBeNull();
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 20, clientY: 20, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("canvas-inspector")).toBeNull();
  });

  it("selecting empty space clears the selection without changing elements", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={[]} onChange={onChange} />);
    // Select tool is default; pointer-down over nothing → hit() returns null, no element created.
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 5, clientY: 5, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("canvas-inspector")).toBeNull();
  });

  it("drags a selected element with the move tool", () => {
    const els: CanvasElement[] = [{ id: "s1", type: "sticky", x: 10, y: 10, w: 120, h: 80, text: "hi" }];
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={els} onChange={onChange} />);
    const surface = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(surface, { clientX: 20, clientY: 20, pointerId: 1 }); // grabs the sticky
    fireEvent.pointerMove(surface, { clientX: 50, clientY: 60, pointerId: 1 }); // drag by (30, 40)
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({ id: "s1", x: 40, y: 50 });
  });

  it("draws a freehand pen stroke and commits it on pointer-up", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("canvas-tool-pen"));
    const surface = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 50, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    // Committed: a `draw` element with more than one point.
    const committed = onChange.mock.calls.at(-1)![0];
    expect(committed).toHaveLength(1);
    expect(committed[0]!.type).toBe("draw");
    expect((committed[0]! as { points: number[][] }).points.length).toBeGreaterThan(1);
  });

  it("discards a degenerate pen dot (a single point) without committing", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("canvas-tool-pen"));
    const surface = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 }); // no move → only one point
    expect(onChange).not.toHaveBeenCalled();
  });

  it("draws a connector and commits it once it has length", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("canvas-tool-connector"));
    const surface = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 120, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    const committed = onChange.mock.calls.at(-1)![0];
    expect(committed).toHaveLength(1);
    expect(committed[0]!.type).toBe("connector");
  });

  it("discards a zero-length connector", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("canvas-tool-connector"));
    const surface = screen.getByTestId("canvas-surface");
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 }); // never moved
    expect(onChange).not.toHaveBeenCalled();
  });

  it("creates a shape of the chosen kind and lets the inspector re-pick it", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    const { rerender } = render(<CanvasEditor elements={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("canvas-tool-shape"));
    // The shape toolbar shows a kind picker; choose an ellipse before dropping it.
    fireEvent.change(screen.getByTestId("canvas-shape-kind"), { target: { value: "ellipse" } });
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 30, clientY: 30, pointerId: 1 });
    const created = onChange.mock.calls.at(-1)![0][0]!;
    expect(created).toMatchObject({ type: "shape", shape: "ellipse" });

    // Feed the created shape back in as selected, then change its kind via the inspector.
    rerender(<CanvasEditor elements={[created]} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 35, clientY: 35, pointerId: 1 });
    fireEvent.change(screen.getByLabelText("Selected shape kind"), { target: { value: "diamond" } });
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({ id: created.id, shape: "diamond" });
  });

  it("recolours the active sticky tool and drops a sticky of that colour", () => {
    const onChange = vi.fn<(next: CanvasElement[]) => void>();
    render(<CanvasEditor elements={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("canvas-tool-sticky"));
    fireEvent.click(screen.getByTestId("canvas-color-blue"));
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 40, clientY: 30, pointerId: 1 });
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({ type: "sticky", color: "blue" });
  });

  it("shows 'Creating…' on the convert button while a conversion is in flight", () => {
    const els: CanvasElement[] = [{ id: "s1", type: "sticky", x: 10, y: 10, w: 120, h: 80, text: "Cutover" }];
    render(<CanvasEditor elements={els} onChange={() => {}} onConvertSticky={() => {}} converting />);
    fireEvent.pointerDown(screen.getByTestId("canvas-surface"), { clientX: 20, clientY: 20, pointerId: 1 });
    const btn = screen.getByTestId("canvas-to-issue");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Creating…");
  });
});
