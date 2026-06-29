/**
 * Identity-provider presets for the setup wizard — "Sign in with Google / Microsoft" without
 * standing up an IdP. OmniProject is already an OIDC relying party; these are guided PRESETS
 * over that existing flow (no new protocol), giving the operator the issuer URL, the exact env
 * to set, and how that provider exposes group claims for role mapping.
 *
 * Removes the biggest charity/SME barrier: most already have Google Workspace or Microsoft 365,
 * so they can use real accounts immediately rather than deploying Authentik/Keycloak.
 *
 * No secrets here — the operator creates the OAuth client in their provider console and supplies
 * OIDC_CLIENT_ID / OIDC_CLIENT_SECRET via env; we only describe what to set.
 */

export interface IdpPreset {
  id: string;
  label: string;
  /** Which login flow this preset drives: a standards OIDC relying party, or the generic
   *  OAuth2 (Authorization Code) path for non-OIDC providers (e.g. GitHub). */
  kind: "oidc" | "oauth2";
  /** Audience this preset suits (shown in the wizard). */
  audience: string;
  /** The OIDC issuer URL, with `{placeholder}` tokens the operator fills (e.g. {tenant}).
   *  Empty for `oauth2` presets, which use explicit endpoints instead. */
  issuerTemplate: string;
  /** OAuth2-only: the authorize / token / userinfo endpoints (non-OIDC providers have no
   *  discovery document, so they are listed explicitly). Absent for `oidc` presets. */
  endpoints?: { authUrl: string; tokenUrl: string; userInfoUrl: string };
  /** Recommended scope. */
  scope: string;
  /** How this provider exposes group/role membership for the role map (advisory). */
  groupsClaimNote: string;
  /** The env keys to set (values come from the provider console / the wizard). */
  envKeys: string[];
  /** Where to create the OAuth app. */
  consoleUrl: string;
  /** Operator-facing setup notes (gotchas first). */
  notes: string[];
}

export const IDP_PRESETS: readonly IdpPreset[] = [
  {
    id: "google",
    kind: "oidc",
    label: "Google Workspace",
    audience: "Charities / SMEs already on Google Workspace or Gmail.",
    issuerTemplate: "https://accounts.google.com",
    scope: "openid email profile",
    groupsClaimNote:
      "Google does NOT emit group claims in the OIDC token by default. Map roles by email/domain in the role-map editor, or surface Cloud Identity groups via a custom claim. Otherwise authenticated users get the default role.",
    envKeys: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"],
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    notes: [
      "Create an OAuth 2.0 Client (type: Web application) in Google Cloud → APIs & Services → Credentials.",
      "Add the redirect URI shown below to 'Authorised redirect URIs'.",
      "Set OIDC_ISSUER_URL=https://accounts.google.com and paste the client id/secret into the env.",
    ],
  },
  {
    id: "microsoft",
    kind: "oidc",
    label: "Microsoft Entra ID (Microsoft 365)",
    audience: "Organisations on Microsoft 365 / Entra ID (Azure AD).",
    issuerTemplate: "https://login.microsoftonline.com/{tenant}/v2.0",
    scope: "openid email profile",
    groupsClaimNote:
      "Add a 'groups' (or 'roles') claim in the app registration's Token configuration; the claim values are object ids or names — map them to OmniProject roles in the role-map editor.",
    envKeys: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"],
    consoleUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    notes: [
      "Register an app in Entra ID → App registrations; note the Directory (tenant) id.",
      "Replace {tenant} in the issuer with your tenant id (or 'organizations' for multi-tenant).",
      "Add the redirect URI below as a 'Web' platform redirect; create a client secret.",
      "Token configuration → add the 'groups' claim if you want group→role mapping.",
    ],
  },
  {
    id: "authentik",
    kind: "oidc",
    label: "Authentik (bundled / self-hosted)",
    audience: "No corporate IdP — run the bundled Authentik (docker-compose.standalone.yml).",
    issuerTemplate: "https://{authentik-host}/application/o/{app-slug}/",
    scope: "openid email profile",
    groupsClaimNote:
      "The bundled blueprint emits a 'groups' claim with omni-admins / omni-pmo / omni-managers / omni-contributors / omni-viewers, already mapped to roles.",
    envKeys: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"],
    consoleUrl: "https://goauthentik.io/docs/",
    notes: [
      "Bring up the standalone stack; the blueprint creates the OmniProject app + the omni-* groups.",
      "Copy the issuer (Provider → OpenID Configuration Issuer) and the client id/secret.",
    ],
  },
  {
    id: "generic",
    kind: "oidc",
    label: "Other OIDC provider",
    audience: "Any standards-compliant OIDC IdP (Keycloak, Okta, Auth0, Ping, …).",
    issuerTemplate: "https://{your-issuer}",
    scope: "openid email profile",
    groupsClaimNote:
      "Emit a 'groups' or 'roles' claim and map the values in the role-map editor (OIDC_*_ROLES / the editable map).",
    envKeys: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"],
    consoleUrl: "",
    notes: ["Register a confidential web client; add the redirect URI below; emit a groups/roles claim."],
  },
  {
    id: "github",
    kind: "oauth2",
    label: "GitHub (OAuth2)",
    audience: "Teams who already sign in with GitHub (GitHub is OAuth2, not OIDC).",
    issuerTemplate: "",
    endpoints: {
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userInfoUrl: "https://api.github.com/user",
    },
    scope: "read:user user:email",
    groupsClaimNote:
      "GitHub's /user has no roles. Authenticated users get the default role; map specific users by login/email in the role-map editor. (Org/team-based roles would need extra API calls — not wired here.)",
    envKeys: [
      "OAUTH2_AUTH_URL",
      "OAUTH2_TOKEN_URL",
      "OAUTH2_USERINFO_URL",
      "OAUTH2_CLIENT_ID",
      "OAUTH2_CLIENT_SECRET",
      "OAUTH2_SCOPE",
      "OAUTH2_USERINFO_SUB_FIELD=id",
      "OAUTH2_USERINFO_NAME_FIELD=name",
      "OAUTH2_USERINFO_EMAIL_FIELD=email",
    ],
    consoleUrl: "https://github.com/settings/developers",
    notes: [
      "Create an OAuth App in GitHub → Settings → Developer settings → OAuth Apps.",
      "Set the Authorization callback URL to the redirect URI shown below (…/api/auth/oauth2/callback).",
      "Copy the Client ID + generate a Client secret into OAUTH2_CLIENT_ID / OAUTH2_CLIENT_SECRET.",
      "The endpoints above are pre-filled into the OAUTH2_*_URL env; GitHub uses id/login (not sub) for identity.",
    ],
  },
] as const;

/** A preset by id, or undefined. */
export function idpPreset(id: string): IdpPreset | undefined {
  return IDP_PRESETS.find((p) => p.id === id);
}
