import { useQuery, useMutation } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { PrimitiveDefShape } from "@workspace/backend-catalogue";

/**
 * Primitive Studio client hooks over `/api/studio/*` (roadmap X.2). The studio "skill" turns a description
 * into a candidate primitive bundle and validates it; the SPA renders it back and iterates. Generate is
 * contributor+; governed by the `ai-authoring` capability. Behind the default-off `studio` feature module.
 * The final write reuses the registry submit path (see lib/registry).
 */

/** A registry submission the studio proposes (mirrors the server shape). */
export interface PrimitiveSubmission {
  kind: "primitive";
  name: string;
  publisher: string;
  version: string;
  description: string;
  tags: string[];
  payload: Record<string, unknown>;
}

/** The studio's generate result: the proposed submission + the deterministic test outcome. */
export interface PrimitiveStudioResult {
  submission: PrimitiveSubmission;
  valid: boolean;
  errors: string[];
  def?: PrimitiveDefShape;
}

export interface StudioImage {
  mime: string;
  dataBase64: string;
}

export interface GenerateInput {
  description: string;
  feedback?: string;
  previous?: Record<string, unknown>;
  /** A reference picture (a sketch / screenshot) the primitive should be based on. */
  image?: StudioImage;
}

export const studioStatusKey = ["studio-status"] as const;

/** Whether an AI provider is configured (the studio needs one). */
export function useStudioStatus() {
  return useQuery({ queryKey: studioStatusKey, queryFn: () => getJson<{ available: boolean }>("/api/studio/status"), staleTime: 60_000 });
}

/** Generate (or iterate on) a candidate primitive bundle from a description. */
export function useGeneratePrimitive() {
  return useMutation({
    mutationFn: (input: GenerateInput) =>
      sendJson<{ result: PrimitiveStudioResult }>("/api/studio/primitive", input, "POST").then((r) => r.result),
  });
}
