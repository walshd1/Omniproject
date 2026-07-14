import { describe, it, expect, vi, afterEach } from "vitest";
import { serializeSvg, buildExportFilename, downloadBlob, svgToRasterBlob, exportSvg } from "./artifact-export";

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

/** A fake 2-D canvas context recording the raster calls the exporter makes. */
interface FakeCtx {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

/**
 * Stub the browser raster plumbing jsdom lacks: URL object-URLs, an <img> whose `src` setter
 * fires onload/onerror on a microtask, and a <canvas> whose getContext returns a recording ctx
 * and whose toBlob yields (or refuses) a Blob. Returns a restore() for a finally block.
 */
function stubRaster(opts: {
  imgFails?: boolean;
  ctxNull?: boolean;
  blobNull?: boolean;
} = {}): { ctx: FakeCtx; toBlob: ReturnType<typeof vi.fn>; restore: () => void } {
  const ctx: FakeCtx = { fillStyle: "", fillRect: vi.fn(), scale: vi.fn(), drawImage: vi.fn() };
  const toBlob = vi.fn((cb: (b: Blob | null) => void) =>
    cb(opts.blobNull ? null : new Blob(["raster"], { type: "image/png" })),
  );

  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });

  class FakeImage {
    width = 0;
    height = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => (opts.imgFails ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);

  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === "canvas") {
      Object.assign(el, {
        getContext: () => (opts.ctxNull ? null : ctx),
        toBlob,
      });
    }
    return el as HTMLElement;
  });

  return { ctx, toBlob, restore: () => vi.unstubAllGlobals() };
}

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

  it("stamps width/height from the bounding box when the svg has neither width nor viewBox", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    const out = serializeSvg(svg);
    // jsdom's getBoundingClientRect is 0×0, but the attributes are written from it regardless.
    expect(out).toContain('width="0"');
    expect(out).toContain('height="0"');
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

describe("svgToRasterBlob", () => {
  it("rasterises a PNG onto a canvas without painting a ground", async () => {
    const svg = makeSvg();
    svg.setAttribute("width", "120");
    svg.setAttribute("height", "80");
    const { ctx, restore } = stubRaster();
    try {
      const blob = await svgToRasterBlob(svg, "png", 2);
      expect(blob).toBeInstanceOf(Blob);
      expect(ctx.fillRect).not.toHaveBeenCalled(); // PNG keeps its alpha — no white ground
      expect(ctx.scale).toHaveBeenCalledWith(2, 2);
      expect(ctx.drawImage).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("paints an opaque white ground for JPEG (no alpha channel)", async () => {
    const svg = makeSvg();
    const { ctx, restore } = stubRaster();
    try {
      await svgToRasterBlob(svg, "jpeg");
      expect(ctx.fillStyle).toBe("#ffffff");
      expect(ctx.fillRect).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("falls back to the width/height attributes then a 600×400 default when there is no layout box", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg); // 0×0 box, no width attr → default 600×400
    const { restore } = stubRaster();
    try {
      const blob = await svgToRasterBlob(svg, "png", 1);
      expect(blob).toBeInstanceOf(Blob);
    } finally {
      restore();
    }
  });

  it("rejects when the SVG image fails to load", async () => {
    const svg = makeSvg();
    const { restore } = stubRaster({ imgFails: true });
    try {
      await expect(svgToRasterBlob(svg, "png")).rejects.toThrow(/failed to load/);
    } finally {
      restore();
    }
  });

  it("rejects when the 2-D context is unavailable", async () => {
    const svg = makeSvg();
    const { restore } = stubRaster({ ctxNull: true });
    try {
      await expect(svgToRasterBlob(svg, "png")).rejects.toThrow(/context unavailable/);
    } finally {
      restore();
    }
  });

  it("rejects when the canvas produces no blob", async () => {
    const svg = makeSvg();
    const { restore } = stubRaster({ blobNull: true });
    try {
      await expect(svgToRasterBlob(svg, "png")).rejects.toThrow(/no blob/);
    } finally {
      restore();
    }
  });
});

describe("exportSvg", () => {
  it("downloads the raw serialised SVG for the svg format (no rasterisation)", async () => {
    const svg = makeSvg();
    const { restore } = stubRaster();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await exportSvg(svg, "svg", "My Chart");
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      click.mockRestore();
      restore();
    }
  });

  it("rasterises then downloads for a png export", async () => {
    const svg = makeSvg();
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "100");
    const { ctx, restore } = stubRaster();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await exportSvg(svg, "png", "My Chart");
      expect(ctx.drawImage).toHaveBeenCalled();
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      click.mockRestore();
      restore();
    }
  });
});
