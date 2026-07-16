import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Annotation, Deliverable } from "@workspace/backend-catalogue";
import { AnnotationOverlay } from "./AnnotationOverlay";

/** The proof annotation overlay: tool selection, click-to-place, and the selected-annotation inspector. */
const IMG: Deliverable = { kind: "image", url: "https://cdn.example/mockup.png", label: "Mockup" };

describe("AnnotationOverlay", () => {
  it("renders the deliverable image + a tool per annotation primitive", () => {
    render(<AnnotationOverlay deliverable={IMG} annotations={[]} onChange={() => {}} />);
    expect(screen.getByTestId("deliverable-image")).toBeInTheDocument();
    for (const t of ["select", "pin", "box", "highlight"]) expect(screen.getByTestId(`annotation-tool-${t}`)).toBeInTheDocument();
  });

  it("renders a PDF deliverable via <object> with a link fallback", () => {
    render(<AnnotationOverlay deliverable={{ kind: "pdf", url: "https://cdn.example/spec.pdf" }} annotations={[]} onChange={() => {}} />);
    expect(screen.getByTestId("deliverable-pdf")).toBeInTheDocument();
  });

  it("places a pin on click when the pin tool is active", () => {
    const onChange = vi.fn<(next: Annotation[]) => void>();
    render(<AnnotationOverlay deliverable={IMG} annotations={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("annotation-tool-pin"));
    fireEvent.pointerDown(screen.getByTestId("annotation-surface"), { clientX: 40, clientY: 30, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0]![0];
    expect(added).toHaveLength(1);
    expect(added[0]!.type).toBe("pin");
  });

  it("shows an inspector for a selected annotation and edits its note + deletes it", () => {
    const anns: Annotation[] = [{ id: "a1", type: "pin", x: 0.2, y: 0.2, text: "fix" }];
    const onChange = vi.fn<(next: Annotation[]) => void>();
    render(<AnnotationOverlay deliverable={IMG} annotations={anns} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByTestId("annotation-a1"), { pointerId: 1 });
    const note = screen.getByTestId("annotation-note") as HTMLInputElement;
    expect(note.value).toBe("fix");
    fireEvent.change(note, { target: { value: "make it pop" } });
    expect(onChange.mock.calls.at(-1)![0][0]).toMatchObject({ id: "a1", text: "make it pop" });

    fireEvent.click(screen.getByTestId("annotation-delete"));
    expect(onChange.mock.calls.at(-1)![0]).toEqual([]);
  });

  it("hides all editing in read-only mode (a viewer still sees markers)", () => {
    const anns: Annotation[] = [{ id: "a1", type: "pin", x: 0.2, y: 0.2 }];
    render(<AnnotationOverlay deliverable={IMG} annotations={anns} onChange={() => {}} readOnly />);
    expect(screen.queryByTestId("annotation-toolbar")).not.toBeInTheDocument();
    expect(screen.getByTestId("annotation-a1")).toBeInTheDocument();
  });
});
