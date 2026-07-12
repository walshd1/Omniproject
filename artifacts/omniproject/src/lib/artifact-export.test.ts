import { describe, it, expect, vi, afterEach } from "vitest";
import { serializeSvg, buildExportFilename, downloadBlob } from "./artifact-export";

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", "50");
  rect.setAttribute("height", "50");
  svg.appendChild(rect);
  document.body.appendChild(svg);
  return svg;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("serializeSvg", () => {
  it("produces a standalone document with the svg namespace and the shapes", () => {
    const out = serializeSvg(makeSvg());
    expect(out).toContain("<?xml");
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain("<rect");
    expect(out).toContain('viewBox="0 0 100 100"');
  });

  it("does not mutate the on-screen element (works on a clone)", () => {
    const svg = makeSvg();
    serializeSvg(svg);
    expect(svg.getAttribute("xmlns")).toBeNull(); // added only to the clone
  });
});

describe("buildExportFilename", () => {
  it("slugifies the title and appends the format", () => {
    expect(buildExportFilename("Velocity — Sprint 4!", "svg")).toBe("velocity-sprint-4.svg");
    expect(buildExportFilename("  ", "png")).toBe("artifact.png");
    expect(buildExportFilename("Burn/Down", "jpeg")).toBe("burn-down.jpeg");
  });
});

describe("downloadBlob", () => {
  it("clicks a temporary anchor with the download name", () => {
    const clicked: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === "a") vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => clicked.push((el as HTMLAnchorElement).download));
      return el;
    });
    // jsdom lacks object URLs — stub them.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};

    downloadBlob(new Blob(["<svg/>"]), "chart.svg");
    expect(clicked).toEqual(["chart.svg"]);
  });
});
