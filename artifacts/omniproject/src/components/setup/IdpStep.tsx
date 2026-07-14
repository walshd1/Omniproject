import { useIdp, type IdpStatus, type IdpPreset } from "../../lib/idp";
import { NeedsHelp, TechDetails } from "./shared";

/**
 * Setup-wizard "staff accounts" step. OmniProject doesn't store users — your IdP does — so
 * this walks an admin through giving staff real accounts + roles. For a charity/self-hoster
 * with no corporate SSO, it guides the BUNDLED IdP (Authentik) path: the OmniProject app + the
 * `omni-*` role groups are pre-created by the blueprint, so you just create staff and assign a
 * group. The group→role mapping is shown so it's unambiguous.
 */
function RoleTable({ idp }: { idp: IdpStatus }) {
  // Prefer the live mapping; fall back to the bundled defaults when nothing is configured yet.
  const rows = idp.roleGroups.map((r) => ({
    role: r.role,
    groups: r.groups.length ? r.groups : (idp.suggestedGroups[r.role] ? [idp.suggestedGroups[r.role]!] : []),
  }));
  return (
    <table className="w-full text-left text-sm">
      <thead><tr className="text-xs uppercase tracking-wider text-muted-foreground"><th className="py-1">Role</th><th>IdP group(s)</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.role} className="border-t border-border">
            <td className="py-1 font-medium">{r.role}</td>
            <td className="font-mono text-xs text-muted-foreground">{r.groups.join(", ") || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Guided "Sign in with Google / Microsoft / …" presets over the existing OIDC flow. */
function PresetCards({ presets }: { presets: IdpPreset[] }) {
  if (!presets?.length) return null;
  return (
    <div className="mt-4 space-y-2" data-testid="idp-presets">
      <h3 className="text-sm font-bold">Already use Google or Microsoft for logins?</h3>
      <p className="text-xs text-muted-foreground">
        Most teams already have Google Workspace or Microsoft 365 — you can use that instead of
        setting up anything new. This part is technical (creating an app registration in that
        console) — worth handing to IT if you have one. Click a card below for exact steps.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map((p) => (
          <details key={p.id} className="rounded border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{p.label}</summary>
            <p className="mt-1 text-xs text-muted-foreground">{p.audience}</p>
            {p.kind === "oauth2" && p.endpoints ? (
              <p className="mt-2 text-xs"><span className="font-semibold">Authorize:</span> <span className="font-mono">{p.endpoints.authUrl}</span></p>
            ) : (
              <p className="mt-2 text-xs"><span className="font-semibold">Issuer:</span> <span className="font-mono">{p.issuerTemplate}</span></p>
            )}
            <p className="text-xs"><span className="font-semibold">Env:</span> <span className="font-mono">{p.envKeys.join(", ")}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">{p.groupsClaimNote}</p>
            {p.consoleUrl && <a className="text-xs text-primary underline" href={p.consoleUrl} target="_blank" rel="noreferrer">Open provider console →</a>}
          </details>
        ))}
      </div>
    </div>
  );
}

export function IdpStep() {
  const { data: idp } = useIdp();
  if (!idp) return null;

  const adminLink = idp.issuerOrigin ? `${idp.issuerOrigin}/if/admin/` : "";

  return (
    <section className="rounded-lg border border-border bg-card p-5" data-testid="idp-step">
      <h2 className="text-lg font-bold">Staff accounts &amp; roles</h2>

      {idp.mode === "oidc" ? (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-muted-foreground">
            Company login is already switched on{idp.bundled ? " (using the built-in login system)" : ""} —
            staff accounts live in your login system
            {idp.issuerOrigin && <> (<span className="font-mono">{idp.issuerOrigin}</span>)</>}, not in OmniProject.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Open your login system's admin screen{adminLink && <> — <a className="text-primary underline" href={adminLink} target="_blank" rel="noreferrer">{adminLink}</a></>} and create a user for each staff member.</li>
            <li>Add each user to the group for the role you want them to have (below).</li>
            <li>They sign in at this app — their role follows from their group, nothing more to set up here.</li>
          </ol>
          <div className="rounded border border-border p-3" data-testid="idp-rolemap"><RoleTable idp={idp} /></div>
          <PresetCards presets={idp.presets} />
        </div>
      ) : (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-muted-foreground">
            Right now everyone who opens this app is treated as an admin — fine for trying it out,
            not fine once real people are using it. To give each staff member their own account and
            role, you need a proper login system (an "identity provider"). OmniProject ships with a
            free one built in, so you don't need to buy or configure anything separate.
          </p>
          <NeedsHelp>
            Setting up the login system itself is a one-time, server-side step — hand this to
            whoever hosts OmniProject for you. Once it's running, <em>you</em> just create a user
            per staff member and pick their role, below.
          </NeedsHelp>
          <TechDetails label="Technical steps for whoever hosts this">
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Bring up the standalone stack (<span className="font-mono">docker compose -f docker-compose.standalone.yml up -d</span>). The OmniProject app and the <span className="font-mono">omni-*</span> role groups are pre-created by the bundled blueprint.</li>
              <li>Set <span className="font-mono">OIDC_CLIENT_SECRET</span> in <span className="font-mono">.env</span> and restart — that points this app at the bundled IdP.</li>
              <li>The IdP must allow this redirect URI: <span className="font-mono">{idp.callbackUrl}</span> (the blueprint sets it automatically).</li>
            </ol>
            <p className="text-muted-foreground">
              Full steps: <span className="font-mono">docs/DEPLOY-LOCAL.md</span> / <span className="font-mono">docs/SMALL-ORG-GUIDE.md</span>.
            </p>
          </TechDetails>
          <p className="text-muted-foreground">
            Once that's running: in the admin screen, create a user per staff member and add them
            to the group for their role:
          </p>
          <div className="rounded border border-border p-3" data-testid="idp-rolemap"><RoleTable idp={idp} /></div>
          <PresetCards presets={idp.presets} />
        </div>
      )}
    </section>
  );
}
