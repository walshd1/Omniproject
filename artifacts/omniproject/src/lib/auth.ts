import { useQuery } from "@tanstack/react-query";

export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
}

export interface AuthState {
  authenticated: boolean;
  mode: "oidc" | "demo";
  user: AuthUser | null;
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
