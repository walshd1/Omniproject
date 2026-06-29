import { useIdp, type IdpStatus, type IdpPreset } from "../../lib/idp";

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
function PresetCards({ presets, callbackUrl }: { presets: IdpPreset[]; callbackUrl: string }) {
  if (!presets?.length) return null;
  return (
    <div className="mt-4 space-y-2" data-testid="idp-presets">
      <h3 className="text-sm font-bold">Use an SSO you already have</h3>
      <p className="text-xs text-muted-foreground">
        Most teams already have Google Workspace or Microsoft 365 — no need to deploy an IdP. Create an
        OAuth app there, add the redirect URI <span className="font-mono">{callbackUrl}</span>, then set the env below.
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
            SSO is active{idp.bundled ? " via the bundled IdP" : ""} — accounts live in your IdP
            {idp.issuerOrigin && <> (<span className="font-mono">{idp.issuerOrigin}</span>)</>}.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Open your IdP admin{adminLink && <> — <a className="text-primary underline" href={adminLink} target="_blank" rel="noreferrer">{adminLink}</a></>} and create a user for each staff member.</li>
            <li>Add each user to the group for the role you want them to have (below).</li>
            <li>They sign in at this app — their role follows from their group, no per-user setup here.</li>
          </ol>
          <div className="rounded border border-border p-3" data-testid="idp-rolemap"><RoleTable idp={idp} /></div>
          <PresetCards presets={idp.presets} callbackUrl={idp.callbackUrl} />
        </div>
      ) : (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-muted-foreground">
            You're in <strong>demo mode</strong> (everyone is admin). To give your team real
            accounts + roles <em>without a corporate IdP</em>, use the <strong>bundled identity
            provider</strong> (Authentik) that ships with the standalone deployment — no cloud, no licence.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Bring up the standalone stack (<span className="font-mono">docker compose -f docker-compose.standalone.yml up -d</span>). The OmniProject app and the <span className="font-mono">omni-*</span> role groups are pre-created by the bundled blueprint.</li>
            <li>Set <span className="font-mono">OIDC_CLIENT_SECRET</span> in <span className="font-mono">.env</span> and restart — that points this app at the bundled IdP.</li>
            <li>In the Authentik admin, create a user per staff member and add them to the group for their role:</li>
          </ol>
          <div className="rounded border border-border p-3" data-testid="idp-rolemap"><RoleTable idp={idp} /></div>
          <p className="text-xs text-muted-foreground">
            The IdP must allow this redirect URI: <span className="font-mono">{idp.callbackUrl}</span> (the blueprint sets it for the bundled IdP). Full steps in <span className="font-mono">docs/DEPLOY-LOCAL.md</span> / <span className="font-mono">docs/SMALL-ORG-GUIDE.md</span>.
          </p>
          <PresetCards presets={idp.presets} callbackUrl={idp.callbackUrl} />
        </div>
      )}
    </section>
  );
}
