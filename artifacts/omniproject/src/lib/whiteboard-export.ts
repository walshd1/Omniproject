import type { CanvasElement } from "@workspace/backend-catalogue";
import { elementBounds } from "./canvas-geometry";
import { slug } from "./slug";

/**
 * Whiteboard EXPORT (roadmap 2.3). Turn the live canvas into a portable file — a standalone SVG (vector,
 * cropped to the scene with a white background) or a rasterised PNG. Everything is client-side: nothing is
 * uploaded, so there is no residency concern. The scene-bounds maths is pure (unit-tested); the SVG string
 * is built by cloning the live `<svg>` (so it captures exactly what's on screen — roughjs paths, freehand
 * strokes and all) rather than re-deriving the drawing.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export interface Box { x: number; y: number; w: number; h: number }

/** The bounding box of a whole scene, padded; a sensible default for an empty scene. Pure + tested. */
export function sceneBounds(elements: CanvasElement[], pad = 24): Box {
  if (elements.length === 0) return { x: 0, y: 0, w: 640, h: 480 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const b = elementBounds(el);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
}

/**
 * Serialize a live canvas `<svg>` to a STANDALONE svg string, cropped to the scene bounds with an opaque
 * white background (so a rasterised PNG isn't transparent). The source is cloned, so the on-screen element
 * is untouched.
 */
export function toExportSvg(source: SVGSVGElement, elements: CanvasElement[]): string {
  const box = sceneBounds(elements);
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(Math.round(box.w)));
  clone.setAttribute("height", String(Math.round(box.h)));
  clone.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  // A white backing rect that covers the whole viewBox — prepended so it sits behind every element.
  const rect = source.ownerDocument.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(box.x)); rect.setAttribute("y", String(box.y));
  rect.setAttribute("width", String(box.w)); rect.setAttribute("height", String(box.h));
  rect.setAttribute("fill", "#ffffff");
  clone.insertBefore(rect, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

/** Rasterise an SVG string to a PNG blob at `scale`× (browser-only; via an offscreen canvas). */
export async function svgToPngBlob(svg: string, box: Box, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not render the scene"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.w * scale));
    canvas.height = Math.max(1, Math.round(box.h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the PNG"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Slugify a board name into a safe filename stem (letters/digits/dash), falling back to "whiteboard". */
export function exportFileStem(name: string): string {
  return slug(name).slice(0, 60) || "whiteboard";
}

/** Trigger a browser download of a blob under `filename`. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
