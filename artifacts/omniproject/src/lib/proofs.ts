import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Annotation, Deliverable, ProofDecision } from "@workspace/backend-catalogue";
import { getJson, sendJson } from "./api";

/**
 * Proofing / deliverable-review client hooks over `/api/proofs/*` (roadmap 2.4). A proof REFERENCES a
 * deliverable (image/PDF that lives elsewhere — zero-at-rest) and carries typed `annotation` primitives
 * (pin/box/highlight, normalised 0..1 coords) plus a review decision bound to the version. Saved to a
 * STORAGE TARGET the author picks — their private / a project's / the org-wide encrypted-JSON area — with a
 * self-describing id so a read routes to the right store. The annotation UI is a later slice; this is the
 * data layer it builds on.
 */

export type { Annotation, Deliverable, ProofDecision } from "@workspace/backend-catalogue";
/** Where a proof is saved (permission-gated server-side). Proofs are always OmniProject-held (no sidecar). */
export type ProofStorage = "user" | "project" | "org";
export interface ProofMeta {
  id: string; name: string; projectId?: string | null; ownerSub?: string | null;
  storage?: ProofStorage; version: number; decision: ProofDecision; updatedAt: string; updatedBy?: string | null;
}
export interface Proof extends ProofMeta {
  deliverable: Deliverable;
  annotations: Annotation[];
  decisionVersion?: number;
  decidedBy?: string | null;
  decidedAt?: string | null;
}
export interface ProofInput { name: string; deliverable: Deliverable; annotations: Annotation[]; storage?: ProofStorage; projectId?: string | null }
/** A decision HELD for a passkey-signed sign-off (202) — the proof isn't stamped until the chain approves. */
export interface ProofDecisionHeld { pending: { proposalId: string; action: string }; message?: string }
export const isProofDecisionHeld = (r: Proof | ProofDecisionHeld): r is ProofDecisionHeld => "pending" in r;

/** The shared-surface room id a proof uses for presence + review comments (matches the server convention).
 *  Pass an annotationId for a THREAD PINNED TO THAT ANNOTATION; omit it for the proof's general discussion. */
export const proofRoomId = (proofId: string, annotationId?: string) =>
  annotationId ? `proof:${proofId}#${annotationId}` : `proof:${proofId}`;

export const proofsKey = (projectId?: string) => ["proofs", projectId ?? "all"] as const;
export const proofKey = (id: string) => ["proof", id] as const;

/** The proofs (deliverable + annotations omitted — a listing), optionally scoped to a project. */
export function useProofs(projectId?: string) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return useQuery({ queryKey: proofsKey(projectId), queryFn: () => getJson<ProofMeta[]>(`/api/proofs${qs}`), staleTime: 15_000 });
}

/** One proof with its deliverable + annotations. */
export function useProof(id: string | undefined) {
  return useQuery({
    queryKey: proofKey(id ?? ""),
    queryFn: () => getJson<Proof>(`/api/proofs/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: 10_000,
  });
}

/** Create a proof (contributor+ server-side). */
export function useCreateProof() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProofInput) => sendJson<Proof>("/api/proofs", input, "POST", "Failed to create proof"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proofs"] }),
  });
}

/** Update a proof — annotations, name, or a replaced deliverable (contributor+ server-side). */
export function useSaveProof(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProofInput) => sendJson<Proof>(`/api/proofs/${encodeURIComponent(id)}`, input, "PUT", "Failed to save proof"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: proofKey(id) }); qc.invalidateQueries({ queryKey: ["proofs"] }); },
  });
}

/** Record an approve / reject / changes-requested decision, bound to the current version. Returns the
 *  updated proof, OR — when a chain gates proof decisions — a {@link ProofDecisionHeld} pending sign-off. */
export function useDecideProof(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decision: Exclude<ProofDecision, "pending">) =>
      sendJson<Proof | ProofDecisionHeld>(`/api/proofs/${encodeURIComponent(id)}/decision`, { decision }, "POST", "Failed to record decision"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: proofKey(id) }); qc.invalidateQueries({ queryKey: ["proofs"] }); },
  });
}

/** Delete a proof (contributor+ server-side; an org proof additionally needs manager+). */
export function useDeleteProof() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson(`/api/proofs/${encodeURIComponent(id)}`, undefined, "DELETE", "Failed to delete proof"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proofs"] }),
  });
}
