import { useQueryClient } from "@tanstack/react-query";
import { useDeploymentProfile, setDeploymentProfile, PROFILE_ORDER, type ProfilePosture } from "../../lib/deployment-profile";

/**
 * Setup-wizard step 0: pick your deployment type up front. Each card is a PRESET for a
 * customer type — what it relaxes, the env it suggests, and what to do next — so an SME,
 * charity or self-hoster doesn't have to wear the enterprise weight by default. Selecting
 * persists the profile (admin); infra-level env (DEPLOYMENT_PROFILE) stays authoritative on
 * a fresh boot.
 */
export function ProfileStep({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data } = useDeploymentProfile();
  if (!data?.catalogue) return null;

  const choose = async (profile: string): Promise<void> => {
    if (!isAdmin || profile === data.profile) return;
    try { await setDeploymentProfile(profile); await qc.invalidateQueries({ queryKey: ["deployment-profile"] }); }
    catch { /* surfaced by the unchanged selection */ }
  };

  const order = PROFILE_ORDER.filter((p) => data.catalogue![p]);

  const Card = (id: string, p: ProfilePosture) => {
    const active = id === data.profile;
    return (
      <button
        key={id}
        type="button"
        disabled={!isAdmin}
        data-testid={`profile-${id}`}
        aria-pressed={active}
        onClick={() => void choose(id)}
        className={`text-left rounded-lg border p-3 transition ${active ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "border-border hover:border-primary/50"} ${isAdmin ? "" : "opacity-60 cursor-not-allowed"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{p.label}</span>
          {active && <span className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">active</span>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{p.audience}</p>
        {p.relaxes.length > 0 && (
          <ul className="mt-2 list-disc pl-4 text-[11px] text-amber-700">{p.relaxes.map((r) => <li key={r}>{r}</li>)}</ul>
        )}
        {p.presetEnv.length > 0 && (
          <div className="mt-2 text-[11px]">
            <span className="font-medium text-muted-foreground">Suggested:</span>{" "}
            <span className="font-mono text-muted-foreground">{p.presetEnv.map((e) => e.key).join(", ")}</span>
          </div>
        )}
      </button>
    );
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5" data-testid="profile-step">
      <h2 className="text-lg font-bold">1 · Choose your deployment type</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick the closest match. Everything advanced stays opt-in; the type only sets sensible
        defaults and relaxes enterprise requirements (TLS, SSO) where they'd get in your way.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {order.map((id) => Card(id, data.catalogue![id]!))}
      </div>
      {!isAdmin && <p className="mt-3 text-xs text-muted-foreground">Sign in as an admin to change the profile.</p>}
    </section>
  );
}
