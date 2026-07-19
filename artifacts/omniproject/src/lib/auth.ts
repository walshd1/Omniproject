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
// `guest` is the invite-only FLOOR (below viewer) — a client-facing portal principal confined to one
// project. It never satisfies a viewer+ gate, so it can't reach the app proper; mirrors the gateway.
export type Role = "guest" | "viewer" | "contributor" | "manager" | "programmeManager" | "pmo" | "admin";

export interface AuthState {
  authenticated: boolean;
  mode: "oidc" | "demo";
  user: AuthUser | null;
  role: Role;
  /** Server session-timeout policy (ms); 0 = disabled. Drives the idle warning. */
  sessionTimeout?: { idleMs: number; absoluteMs: number };
  /** Whether SAML SSO is configured (offered alongside OIDC on the login screen). */
  samlConfigured?: boolean;
  /** Whether generic OAuth2 (non-OIDC, e.g. GitHub) sign-in is configured. */
  oauth2Configured?: boolean;
  /** Whether passwordless magic-link sign-in is enabled (no IdP). */
  magicLinkEnabled?: boolean;
  /** Whether native in-app (username + password) sign-in is available on this deployment. */
  localSignInEnabled?: boolean;
  /** Fresh, IdP-less deployment with no users yet → show the "claim first admin" form. */
  needsFirstAdmin?: boolean;
  /** Present ONLY for a guest principal: the single project it's confined to and its access tier. The SPA
   *  uses this to route a guest to the client portal and nowhere else. */
  guest?: { projectId: string; tier: "read" | "comment" };
  /** This session was flagged as an implausible location jump from its own last login,
   *  and hasn't been re-verified since (a step-up minted after the flag clears it). Not
   *  a lockout — the SPA prompts a step-up before the next sensitive (admin/pmo) action. */
  impossibleTravel?: boolean;
}

/** The linear base ladder. `guest` is the floor (below viewer). `programmeManager` is a scoped rung above
 *  project `manager`; the authorities (pmo/admin) sit above it and confer programmeManager base. */
const BASE_RANK = { guest: 0, viewer: 1, contributor: 2, manager: 3, programmeManager: 4 } as const;
type BaseRole = keyof typeof BASE_RANK;
const AUTHORITIES = new Set<Role>(["pmo", "admin"]);
/** A role's base rung — an authority confers programmeManager-level base (they sit above that rung). */
const baseRank = (role: Role): number => (AUTHORITIES.has(role) ? BASE_RANK.programmeManager : BASE_RANK[role as BaseRole]);

/** Does this role satisfy the gate `min`? Mirrors the gateway's `grantsSatisfy`:
 *  - an AUTHORITY gate (pmo/admin) needs that EXACT authority (orthogonal — admin ≠ pmo);
 *  - a BASE gate (viewer/contributor/manager) uses the ladder (pmo/admin clear `manager`). */
export function roleAtLeast(role: Role | undefined, min: Role): boolean {
  const r = role ?? "viewer";
  if (AUTHORITIES.has(min)) return r === min;
  return baseRank(r) >= BASE_RANK[min as BaseRole];
}

/** Holds either orthogonal authority — the shared gate for the surfaces that belong
 *  to whoever owns governance (business, via PMO) or technical config (via admin),
 *  regardless of which one specifically. */
export function isPmoOrAdmin(role: Role | undefined): boolean {
  return roleAtLeast(role, "admin") || roleAtLeast(role, "pmo");
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

/** A configured OIDC provider for the login screen (secret-free). */
export interface OidcProviderInfo {
  id: string;
  label: string;
  kind: "oidc";
}

/** The configured OIDC providers, so the login screen can render a branded button per provider.
 *  Empty in demo mode. */
export function useAuthProviders() {
  return useQuery({
    queryKey: ["auth", "providers"],
    queryFn: async (): Promise<OidcProviderInfo[]> => {
      const res = await fetch("/api/auth/providers", { credentials: "same-origin" });
      if (!res.ok) return [];
      const body = (await res.json()) as { providers?: OidcProviderInfo[] };
      return body.providers ?? [];
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Redirect the browser into the gateway-driven login flow, optionally for a specific provider. */
export function login(returnTo: string = window.location.pathname, provider?: string): void {
  let url = `/api/auth/login?returnTo=${encodeURIComponent(returnTo || "/")}`;
  if (provider) url += `&provider=${encodeURIComponent(provider)}`;
  window.location.href = url;
}

/** Redirect into the SAML (SP-initiated) login flow. */
export function samlLogin(returnTo: string = window.location.pathname): void {
  window.location.href = `/api/auth/saml/login?returnTo=${encodeURIComponent(returnTo || "/")}`;
}

/** Redirect into the generic OAuth2 (non-OIDC, e.g. GitHub) login flow. */
export function oauth2Login(returnTo: string = window.location.pathname): void {
  window.location.href = `/api/auth/oauth2/login?returnTo=${encodeURIComponent(returnTo || "/")}`;
}

/** Request a passwordless magic-link to an email. Resolves to a dev link when dev mode returns one. */
export async function requestMagicLink(email: string, returnTo = "/"): Promise<{ ok: boolean; devLink?: string }> {
  const res = await fetch("/api/auth/magic/request", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, returnTo }),
  });
  return (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; devLink?: string };
}

/** Sign in a native (in-app) user with a username + password. Returns ok + where to go next. */
export async function localLogin(userName: string, password: string, returnTo = "/"): Promise<{ ok: boolean; error?: string; returnTo?: string }> {
  const res = await fetch("/api/auth/local", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, password, returnTo }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; returnTo?: string };
  return res.ok ? { ok: true, returnTo: body.returnTo ?? returnTo } : { ok: false, error: body.error ?? "Sign-in failed." };
}

/** Claim the FIRST admin on a fresh, IdP-less deployment (username + password). One-time; 409 once users exist. */
export async function bootstrapFirstAdmin(userName: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/auth/local/bootstrap", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return res.ok ? { ok: true } : { ok: false, error: body.error ?? "Could not create the first admin." };
}

/**
 * localStorage keys that hold DATA derived from the signed-in session (recently-viewed project /
 * entity names, etc.) and must not linger for the next user on a shared machine. Device PREFERENCES
 * (locale, a11y, theme, UI toggles) are deliberately NOT here — they carry no session data and
 * wiping them only degrades the next sign-in's UX. Keep this list in step with any new data-bearing
 * localStorage writer.
 */
const SESSION_DATA_LOCAL_KEYS = ["omni:recents", "omniproject-active-project"];

/**
 * Wipe client-side remnants of the session so nothing sensitive survives logout on a shared browser.
 * sessionStorage is entirely session-scoped (scenario snapshots, report sandboxes, portfolio caches
 * live there) so it is cleared wholesale; localStorage keeps device prefs but loses the data-bearing
 * keys above. Best-effort — storage may be blocked/absent (private mode, SSR). The app shell service
 * worker never caches `/api/*` (see lib/pwa.ts), so there is no auth-data Cache Storage to purge.
 */
export function clearClientSessionData(): void {
  try { window.sessionStorage.clear(); } catch { /* storage blocked */ }
  for (const key of SESSION_DATA_LOCAL_KEYS) {
    try { window.localStorage.removeItem(key); } catch { /* storage blocked */ }
  }
}

/** Clear the session and return to the login screen. Wipes client-side session data first, then the
 *  server cookie; the full-page redirect drops the in-memory React Query cache. */
export async function logout(): Promise<void> {
  clearClientSessionData();
  // Purge the encrypted offline cache (my-work/tasks) so nothing survives the session on a shared device.
  await import("./offline-cache").then((m) => m.clearOfflineCache()).catch(() => {});
  // Drop this device's push subscription so a shared device stops receiving the user's notifications.
  await import("./web-push-client").then((m) => m.unsubscribeFromPush()).catch(() => {});
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  window.location.href = "/login";
}
