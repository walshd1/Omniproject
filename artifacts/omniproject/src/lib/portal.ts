import { useQuery, useMutation } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Client-facing guest portal (roadmap 2.2). A guest principal is confined to ONE project and sees only its
 * curated status (name, progress, RAG rollup, dated milestones) — never financial/internal columns; the
 * gateway allow-lists the payload. Managers invite a client as a scoped guest via a single-use magic-link.
 */

export interface PortalStatus {
  project: { id: string; name: string; description: string | null };
  progress: { total: number; done: number; percent: number };
  health: { red: number; amber: number; green: number };
  milestones: { title: string; status: string; dueDate: string }[];
}

export type GuestTier = "read" | "comment";
export interface GuestInviteInput { email: string; projectId: string; tier: GuestTier }

export const portalStatusKey = ["portal", "status"] as const;

/** The signed-in guest's own project status. Fails (isError) for a non-guest / when the portal is off — the
 *  page shows an "unavailable" notice rather than app data. */
export function usePortalStatus() {
  return useQuery({
    queryKey: portalStatusKey,
    queryFn: () => getJson<PortalStatus>("/api/portal/status"),
    retry: false,
    staleTime: 30_000,
  });
}

/** Invite an external client as a guest scoped to one project (manager+, server-enforced). In dev the
 *  response echoes the invite link so it's testable without SMTP. */
export function useInviteGuest() {
  return useMutation({
    mutationFn: (input: GuestInviteInput) =>
      sendJson<{ ok: boolean; link?: string }>("/api/portal/invites", input, "POST", "Failed to send the invite"),
  });
}
