import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDeploymentProfile, HARDENING_LABELS } from "../../lib/deployment-profile";

/**
 * Deployment profile (admin, read-only). Shows the chosen profile, what's been relaxed by
 * choice for a small-org/self-hosted deployment, and which advanced hardening is on vs off —
 * so the relaxations are visible and intentional, not accidental. Set via DEPLOYMENT_PROFILE.
 */
export function DeploymentProfile() {
  const { data: auth } = useAuth();
  const { data } = useDeploymentProfile();
  if (!roleAtLeast(auth?.role, "admin") || !data) return null;

  const relaxed: string[] = [];
  if (!data.tls.servedOverTls) relaxed.push("Plain HTTP (secure cookies + HSTS off) — fine on a trusted LAN");
  if (data.demoAuth.active) relaxed.push(`No SSO — demo auth (everyone admin), accepted as ${data.demoAuth.severity}`);

  const Toggle = ([key, on]: [string, boolean]) => (
    <li key={key} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-sm">
      <span>{HARDENING_LABELS[key] ?? key}</span>
      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${on ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{on ? "on" : "off"}</span>
    </li>
  );

  return (
    <Card data-testid="deployment-profile">
      <CardHeader><CardTitle>Deployment profile</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary" data-testid="profile-label">{data.posture.label}</span>
          <span className="text-xs text-muted-foreground font-mono">{data.profile}</span>
        </div>
        <p className="text-sm text-muted-foreground">{data.posture.summary}</p>

        {relaxed.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">Relaxed by choice</h3>
            <ul className="list-disc pl-5 text-xs text-amber-800">{relaxed.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hardening</h3>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">{Object.entries(data.hardening).map(Toggle)}</ul>
        </div>

        {data.posture.recommend.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recommended for this profile</h3>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">{data.posture.recommend.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Change the profile with the <span className="font-mono">DEPLOYMENT_PROFILE</span> env var (enterprise · business · nonprofit · self-hosted · demo). Everything advanced is opt-in.</p>
      </CardContent>
    </Card>
  );
}
