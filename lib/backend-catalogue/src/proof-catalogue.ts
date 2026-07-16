/**
 * PROOFING / deliverable review model — the neutral, primitive-built shape for OmniProject's creative-review
 * surface (roadmap 2.4). Same architectural principle as documents (wiki blocks) and whiteboards (canvas
 * elements): a proof is a JSON DEFINITION that REFERENCES a deliverable (an image/PDF that lives elsewhere —
 * attachments-as-references, zero-at-rest) and carries a list of typed ANNOTATION PRIMITIVES pinned onto it,
 * plus a review decision. NOT an opaque third-party markup blob.
 *
 * The single `ANNOTATION_TYPES` list is what the authoring palette, the validator AND the unified primitive
 * store (the `annotation` family) all draw from, so the store can never drift from what a proof can contain.
 * The authoritative sanitiser runs server-side before anything is written.
 */

/**
 * The supported annotation types. `pin` — a point marker at (x, y); `box` — a rectangular region (x, y +
 * w, h); `highlight` — a rectangular emphasis region. Coordinates are NORMALISED to the deliverable
 * (0..1 of its width/height), so an annotation survives any render scale.
 */
export type AnnotationType = "pin" | "box" | "highlight";

/** The annotation primitives, as a value — the single list the palette, validator and primitive store
 *  (`annotation` family) all draw from, so the family can't drift from the AnnotationType union. */
export const ANNOTATION_TYPES: readonly AnnotationType[] = ["pin", "box", "highlight"];

/** Annotation types that carry a width/height region (box/highlight). */
export const REGION_ANNOTATION_TYPES: readonly AnnotationType[] = ["box", "highlight"];

/** The deliverable media kinds a proof can reference. */
export type DeliverableKind = "image" | "pdf";
export const DELIVERABLE_KINDS: readonly DeliverableKind[] = ["image", "pdf"];

/**
 * A review decision on a proof version. `pending` — awaiting review; `approved` — signed off;
 * `rejected` — declined; `changes-requested` — needs rework before re-review. Bound to a version so a new
 * deliverable revision re-opens the decision.
 */
export type ProofDecision = "pending" | "approved" | "rejected" | "changes-requested";
export const PROOF_DECISIONS: readonly ProofDecision[] = ["pending", "approved", "rejected", "changes-requested"];
/** The decisions a reviewer can SET (everything except the implicit `pending` starting state). */
export const REVIEW_DECISIONS: readonly ProofDecision[] = ["approved", "rejected", "changes-requested"];

/**
 * One annotation pinned onto a deliverable. Which optional fields apply depends on `type`: a `pin` uses just
 * `x`/`y`; a `box`/`highlight` adds `w`/`h`. `text` is the reviewer's note; `resolved` marks a raised point
 * as addressed. `page` targets a page of a multi-page PDF (1-based; defaults to 1). A generic overlay
 * renderer switches on `type`. All coordinates are normalised (0..1).
 */
export interface Annotation {
  /** Stable id within the proof (for keys + comment-thread anchoring). */
  id: string;
  type: AnnotationType;
  /** Normalised top-left / point position on the deliverable (0..1). */
  x: number;
  y: number;
  /** Normalised region size — box / highlight (0..1). */
  w?: number;
  h?: number;
  /** The reviewer's note. */
  text?: string;
  /** Which page of a multi-page deliverable (PDF) this pins to (1-based). */
  page?: number;
  /** Whether the raised point has been addressed. */
  resolved?: boolean;
}

/** A deliverable under review — a REFERENCE to media that lives elsewhere (never inlined; zero-at-rest). */
export interface Deliverable {
  kind: DeliverableKind;
  /** Safe-scheme URL of the media (validated by the sanitiser). */
  url: string;
  /** Optional human label / filename. */
  label?: string;
}

/** Bounds the sanitiser enforces on a proof. */
export const PROOF_LIMITS = {
  maxName: 200,
  maxLabel: 200,
  /** Max annotations pinned on one proof. */
  maxAnnotations: 1000,
  /** Max characters in an annotation note. */
  maxText: 5000,
  /** Max pages a deliverable annotation may target. */
  maxPage: 5000,
  /** Cap on the serialised proof so a client can't push an unbounded blob into the store. */
  maxProofBytes: 2_000_000,
} as const;
