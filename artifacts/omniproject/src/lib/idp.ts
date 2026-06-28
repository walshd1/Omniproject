import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Identity-setup guidance client. OmniProject delegates auth to an IdP; this drives the
 * wizard's "give your staff real accounts" step — especially the BUNDLED IdP (Authentik) path
 * for charities/self-hosters with no corporate SSO.
 */
export interface IdpStatus {
  mode: "demo" | "oidc";
  issuer: string;
  issuerOrigin: string;
  /** Is the issuer the Authentik that ships in the standalone compose? */
  bundled: boolean;
  /** The redirect URI the IdP must allow. */
  callbackUrl: string;
  /** Live group→role mapping (which IdP group grants which role). */
  roleGroups: { role: string; groups: string[] }[];
  /** Default group names the bundled blueprint creates, per role. */
  suggestedGroups: Record<string, string>;
  profile: string;
}

/** Identity setup status + guidance (admin). */
export function useIdp() {
  return useQuery<IdpStatus>({
    queryKey: ["setup-idp"],
    queryFn: () => getJson("/api/setup/idp"),
    staleTime: 30_000,
  });
}
