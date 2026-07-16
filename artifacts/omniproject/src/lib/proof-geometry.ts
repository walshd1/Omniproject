import type { Annotation, AnnotationType } from "@workspace/backend-catalogue";

/**
 * Pure geometry for the proof annotation overlay (roadmap 2.4). Annotations use NORMALISED coordinates
 * (0..1 of the deliverable's width/height) so a pin survives any render scale; these helpers convert to/from
 * the on-screen rect and place a new annotation. No DOM, no React — unit-tested in isolation.
 */

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export interface NormPoint { x: number; y: number }

/** A client (x, y) mapped into the [0,1] space of a rendered rect. */
export function toNorm(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): NormPoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
}

/** Default region size (normalised) for a new box / highlight. */
export const DEFAULT_REGION = { w: 0.18, h: 0.12 };

/**
 * Build a new annotation of `type` anchored at a normalised point. A `pin` sits AT the point; a region
 * (box/highlight) uses the point as its top-left, clamped so it stays within bounds.
 */
export function placeAnnotation(type: AnnotationType, at: NormPoint, id: string): Annotation {
  if (type === "pin") return { id, type, x: at.x, y: at.y };
  const w = DEFAULT_REGION.w, h = DEFAULT_REGION.h;
  return { id, type, x: clamp01(Math.min(at.x, 1 - w)), y: clamp01(Math.min(at.y, 1 - h)), w, h };
}

/** Move an annotation to a new normalised anchor, keeping any region size and staying in-bounds. */
export function moveAnnotation(ann: Annotation, to: NormPoint): Annotation {
  const w = ann.w ?? 0, h = ann.h ?? 0;
  return { ...ann, x: clamp01(Math.min(to.x, 1 - w)), y: clamp01(Math.min(to.y, 1 - h)) };
}

/** A short id for a new annotation (stable enough for a client-side key; the server re-ids on save if blank). */
export function newAnnotationId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `a-${crypto.randomUUID().slice(0, 8)}`;
  } catch { /* fall through */ }
  return `a-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
