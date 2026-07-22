import { useQuery } from "@tanstack/react-query";

/**
 * The org's canonical identity (id + name + optional logo), read from `/api/org-identity`. Ungated: every
 * deployment has a name and can carry its own logo, independent of the premium white-label branding.
 *
 * `logo` is the org's OWN asset (a raster data URI or https URL), and `showLogo` is the org's opt-in to surface
 * it on screens / reports / exports. Consumers should only render the logo when BOTH are set — see `<OrgLogo>`.
 */
export interface OrgIdentity {
  id: string;
  name: string;
  logo: string;
  showLogo: boolean;
}

export const ORG_IDENTITY_QUERY_KEY = ["org-identity"] as const;

async function fetchOrgIdentity(): Promise<OrgIdentity> {
  const res = await fetch("/api/org-identity", { credentials: "same-origin" });
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as { identity?: Partial<OrgIdentity> };
  const i = body.identity ?? {};
  return {
    id: typeof i.id === "string" ? i.id : "",
    name: typeof i.name === "string" ? i.name : "",
    logo: typeof i.logo === "string" ? i.logo : "",
    showLogo: i.showLogo === true,
  };
}

/** The org identity, or `undefined` while loading / on error. */
export function useOrgIdentity(): OrgIdentity | undefined {
  const { data } = useQuery({ queryKey: ORG_IDENTITY_QUERY_KEY, queryFn: fetchOrgIdentity, staleTime: 60_000 });
  return data;
}
