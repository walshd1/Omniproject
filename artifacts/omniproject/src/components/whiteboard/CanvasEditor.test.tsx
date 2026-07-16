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
});
