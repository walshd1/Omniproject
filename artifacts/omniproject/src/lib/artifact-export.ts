/**
 * Artifact export — turn a rendered chart/primitive into a downloadable file, dependency-free.
 *
 * Our primitives draw as inline SVG whose colours come from `currentColor` and Tailwind text classes, so
 * a naive serialize would lose every colour once the markup leaves the document. `serializeSvg` first
 * inlines the *computed* paint/typography onto a clone, so the exported file is self-contained and looks
 * exactly like what was on screen. From there:
 *   - SVG export is that string in a Blob;
 *   - raster (PNG/JPEG) export rasterises the SVG onto a canvas — no external calls, so it works under
 *     the strict CSP. JPEG has no alpha, so we paint a white ground first.
 *
 * The pure parts (serialize, filename) are unit-tested; the browser parts (canvas, download) are guarded
 * and run only where the APIs exist.
 */
export type ExportFormat = "svg" | "png" | "jpeg";

// The paint + typography properties that must travel with the markup for a faithful standalone render.
const INLINED_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity",
  "color", "opacity", "font-family", "font-size", "font-weight", "text-anchor", "vector-effect",
];

function inlineComputedStyles(src: Element, dst: Element): void {
  const view = src.ownerDocument?.defaultView;
  if (view) {
    const cs = view.getComputedStyle(src);
    let decl = dst.getAttribute("style") ?? "";
    for (const prop of INLINED_PROPS) {
      const value = cs.getPropertyValue(prop);
      // Inline any resolved value — including `fill:none` (line/area paths depend on it).
      if (value) decl += `${prop}:${value};`;
    }
    if (decl) dst.setAttribute("style", decl);
  }
  const srcChildren = src.children;
  const dstChildren = dst.children;
  for (let i = 0; i < srcChildren.length; i++) {
    const s = srcChildren[i];
    const d = dstChildren[i];
    if (s && d) inlineComputedStyles(s, d);
  }
}

/** Serialise an on-screen SVG to a self-contained standalone document string (computed styles inlined). */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  if (!clone.getAttribute("width") && !clone.getAttribute("viewBox")) {
    const rect = svg.getBoundingClientRect();
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));
  }
  inlineComputedStyles(svg, clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** A safe download filename from a human title + format (spaces → dashes, dropped punctuation). */
export function buildExportFilename(title: string, format: ExportFormat): string {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
  return `${base}.${format}`;
}

const MIME: Record<ExportFormat, string> = {
  svg: "image/svg+xml;charset=utf-8",
  png: "image/png",
  jpeg: "image/jpeg",
};

/** Trigger a browser download of a blob under the given filename. No-op outside the browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Rasterise an SVG element to a PNG/JPEG blob at `scale`× device pixels. Browser-only. */
export async function svgToRasterBlob(svg: SVGSVGElement, format: "png" | "jpeg", scale = 2): Promise<Blob> {
  const str = serializeSvg(svg);
  const rect = svg.getBoundingClientRect();
  const width = rect.width || Number(svg.getAttribute("width")) || 600;
  const height = rect.height || Number(svg.getAttribute("height")) || 400;

  const svgUrl = URL.createObjectURL(new Blob([str], { type: MIME.svg }));
  try {
    const img = new Image();
    img.width = width;
    img.height = height;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG rasterisation failed to load"));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    if (format === "jpeg") {
      ctx.fillStyle = "#ffffff"; // JPEG has no alpha — give it an opaque ground.
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export produced no blob"))), MIME[format], 0.92);
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/** Export an SVG element in the chosen format and download it under a title-derived filename. Browser-only. */
export async function exportSvg(svg: SVGSVGElement, format: ExportFormat, title: string): Promise<void> {
  const filename = buildExportFilename(title, format);
  if (format === "svg") {
    downloadBlob(new Blob([serializeSvg(svg)], { type: MIME.svg }), filename);
    return;
  }
  downloadBlob(await svgToRasterBlob(svg, format), filename);
}
