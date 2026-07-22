import { useQuery } from "@tanstack/react-query";
import { sendJson } from "./api";

/**
 * Native in-app users (admin). The roster + role-group assignment; password secrets live server-side in a
 * separately-keyed store and are NEVER returned (only `hasPassword` presence). 404 when the deployment has no
 * encrypted store — the panel hides itself in that case. CSRF is attached by the global fetch patch (lib/csrf).
 */
export interface LocalUserView {
  id: string;
  userName: string;
  displayName: string;
  email: string;
  groups: string[];
  active: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export const usersKey = ["users"] as const;

export function useUsers() {
  return useQuery({
    queryKey: usersKey,
    queryFn: async (): Promise<{ available: boolean; users: LocalUserView[] }> => {
      const res = await fetch("/api/users", { credentials: "same-origin" });
      if (res.status === 404) return { available: false, users: [] };
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { users?: LocalUserView[] };
      return { available: true, users: Array.isArray(body.users) ? body.users : [] };
    },
    retry: false,
    staleTime: 30_000,
  });
}

export async function createUser(input: { userName: string; displayName?: string | undefined; email?: string | undefined; groups?: string[] | undefined; password?: string | undefined }): Promise<void> {
  await sendJson("/api/users", input, "POST", "Could not create the user.");
}

export async function updateUser(id: string, patch: { displayName?: string; email?: string; groups?: string[]; active?: boolean }): Promise<void> {
  await sendJson(`/api/users/${encodeURIComponent(id)}`, patch, "PATCH", "Could not update the user.");
}

export async function setUserPassword(id: string, password: string): Promise<void> {
  await sendJson(`/api/users/${encodeURIComponent(id)}/password`, { password }, "POST", "Could not set the password.");
}

export async function deleteUser(id: string): Promise<void> {
  await sendJson(`/api/users/${encodeURIComponent(id)}`, undefined, "DELETE", "Could not delete the user.");
}
