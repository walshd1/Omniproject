import { useQuery } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Device & active-session inventory client — a thin wrapper over `/api/auth/sessions*`. Lists the caller's
 * own active sessions (this browser plus any other devices) and signs one out. The server tracks sessions in
 * a best-effort directory; each is identified by a non-reversible handle (the raw per-session salt never
 * leaves the server), so nothing here can forge or impersonate a session.
 */

export interface DeviceSession {
  /** Non-reversible public handle for the session (not the raw salt). */
  id: string;
  /** True for the session making this request (the current browser). */
  current: boolean;
  /** Epoch ms the session was first seen. */
  firstSeen: number;
  /** Epoch ms of the most recent activity. */
  lastSeen: number;
  /** The session's User-Agent string, when known. */
  userAgent?: string;
  /** The session's client IP, when known. */
  ip?: string;
}

export const sessionsKey = ["auth", "sessions"] as const;

/** This user's active sessions, newest-activity first (the current one flagged). */
export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => getJson<{ sessions: DeviceSession[] }>("/api/auth/sessions"),
    staleTime: 5_000,
  });
}

/** Sign one device out by its handle. Revoking the current session logs this browser out. */
export function revokeSession(id: string): Promise<{ ok: true; current: boolean }> {
  return sendJson<{ ok: true; current: boolean }>("/api/auth/sessions/revoke", { id }, "POST", "Could not sign that device out.");
}

/** Sign out every OTHER device, keeping this one. Returns how many were revoked. */
export function revokeOtherSessions(): Promise<{ ok: true; revoked: number }> {
  return sendJson<{ ok: true; revoked: number }>("/api/auth/sessions/revoke", { others: true }, "POST", "Could not sign the other devices out.");
}

/** A short, human-friendly device label parsed from a User-Agent string (best-effort, display only). */
export function describeDevice(userAgent?: string): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    /curl\//i.test(ua) ? "curl" :
    "Browser";
  const os =
    /iPhone|iPad|iPod/.test(ua) ? "iOS" : // before macOS: an iOS UA also contains "like Mac OS X"
    /Android/.test(ua) ? "Android" :
    /Windows/.test(ua) ? "Windows" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" :
    "";
  return os ? `${browser} on ${os}` : browser;
}
