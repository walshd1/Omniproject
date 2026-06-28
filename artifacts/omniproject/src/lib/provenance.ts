import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Broker-call provenance client (see the gateway's lib/provenance + routes/provenance).
 * The chain holds only keyed fingerprints — never content — hash-chained so the whole
 * sequence is tamper-evident. Each entry also commits to the INITIATING SESSION via a
 * keyed `sessionMac` (the same sub‖smono‖salt identity the per-session broker key uses),
 * so the dashboard can show which session drove each call, not just the actor's name.
 */
export type ProvenanceHop = "invoke" | "result" | "error";

export interface ProvenanceEntry {
  callId: string;
  seq: number;
  hop: ProvenanceHop;
  action: string;
  actor: string | null;
  /** Keyed fingerprint of the initiating session, or null for system/unauthenticated calls. */
  sessionMac: string | null;
  tMono: string;
  elapsedMs: number;
  tWall: string;
  kver: number;
  contentMac: string;
  prevMac: string | null;
  mac: string;
}

export interface ChainVerdict {
  ok: boolean;
  length: number;
  brokenAt?: number;
  reason?: string;
  /** Key versions present but revoked — integrity still checks, but the guarantee is void. */
  revokedKeyVersions?: number[];
}

export interface ProvenanceChain {
  entries: ProvenanceEntry[];
  chain: ChainVerdict;
}

/** Load the recent broker-call chain + its live integrity verdict (admin). */
export function useProvenanceChain() {
  return useQuery<ProvenanceChain>({
    queryKey: ["provenance-chain"],
    queryFn: () => getJson("/api/provenance"),
    staleTime: 10_000,
  });
}

/** Short, display-friendly form of a 64-char hex MAC (first 10 chars). */
export function shortMac(mac: string | null): string {
  return mac ? mac.slice(0, 10) : "";
}
