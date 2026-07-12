import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { ExportButtons } from "./ExportButtons";
import * as exportLib from "../../lib/artifact-export";

function Harness({ withSvg = true }: { withSvg?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref} data-testid="target">
        {withSvg && (
          <svg viewBox="0 0 10 10" data-testid="the-svg">
            <rect width="10" height="10" />
          </svg>
        )}
      </div>
      <ExportButtons targetRef={ref} title="Velocity" />
    </div>
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("ExportButtons", () => {
  it("renders one button per format", () => {
    render(<Harness />);
    expect(screen.getByTestId("export-svg")).toBeInTheDocument();
    expect(screen.getByTestId("export-png")).toBeInTheDocument();
    expect(screen.getByTestId("export-jpeg")).toBeInTheDocument();
  });

  it("exports the target's svg in the chosen format under the title", async () => {
    const spy = vi.spyOn(exportLib, "exportSvg").mockResolvedValue();
    render(<Harness />);
    fireEvent.click(screen.getByTestId("export-png"));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [svgArg, formatArg, titleArg] = spy.mock.calls[0]!;
    expect((svgArg as SVGElement).tagName.toLowerCase()).toBe("svg");
    expect(formatArg).toBe("png");
    expect(titleArg).toBe("Velocity");
  });

  it("shows an error and does not export when there is no svg", async () => {
    const spy = vi.spyOn(exportLib, "exportSvg").mockResolvedValue();
    render(<Harness withSvg={false} />);
    fireEvent.click(screen.getByTestId("export-svg"));
    expect(await screen.findByTestId("export-error")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
