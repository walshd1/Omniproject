import { useQuery } from "@tanstack/react-query";

export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
}

// Mirrors the gateway's rbac model: a LINEAR base ladder (viewer < contributor < manager)
// PLUS two ORTHOGONAL authorities (pmo, admin) that each confer manager-level base but are
// independent of each other — a pure admin does NOT satisfy `pmo`, and vice-versa. The `role`
// the gateway sends is the single representative label (highest authority, else base).
export type Role = "viewer" | "contributor" | "manager" | "pmo" | "admin";

export interface AuthState {
  authenticated: boolean;
  mode: "oidc" | "demo";
  user: AuthUser | null;
  role: Role;
  /** Server session-timeout policy (ms); 0 = disabled. Drives the idle warning. */
  sessionTimeout?: { idleMs: number; absoluteMs: number };
}

/** The linear base ladder. The authorities (pmo/admin) sit above it and confer manager base. */
const BASE_RANK = { viewer: 0, contributor: 1, manager: 2 } as const;
type BaseRole = keyof typeof BASE_RANK;
const AUTHORITIES = new Set<Role>(["pmo", "admin"]);
/** A role's base rung — an authority confers manager-level base. */
const baseRank = (role: Role): number => (AUTHORITIES.has(role) ? BASE_RANK.manager : BASE_RANK[role as BaseRole]);

/** Does this role satisfy the gate `min`? Mirrors the gateway's `grantsSatisfy`:
 *  - an AUTHORITY gate (pmo/admin) needs that EXACT authority (orthogonal — admin ≠ pmo);
 *  - a BASE gate (viewer/contributor/manager) uses the ladder (pmo/admin clear `manager`). */
export function roleAtLeast(role: Role | undefined, min: Role): boolean {
  const r = role ?? "viewer";
  if (AUTHORITIES.has(min)) return r === min;
  return baseRank(r) >= BASE_RANK[min as BaseRole];
}

async function fetchAuth(): Promise<AuthState> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`auth check failed: ${res.status}`);
  return (await res.json()) as AuthState;
}

/** Reactively track the current session via the gateway. */
export function useAuth() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchAuth,
    retry: false,
    staleTime: 60_000,
  });
}

/** Redirect the browser into the gateway-driven login flow. */
export function login(returnTo: string = window.location.pathname): void {
  const url = `/api/auth/login?returnTo=${encodeURIComponent(returnTo || "/")}`;
  window.location.href = url;
}

/** Clear the session and return to the login screen. */
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  window.location.href = "/login";
}
