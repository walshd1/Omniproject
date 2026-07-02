import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDeploymentProfile,
  setDeploymentProfile,
  applyCharityOnboarding,
  PROFILE_ORDER,
  type ProfilePosture,
  type CharityOnboardingResult,
} from "../../lib/deployment-profile";
import { dashboardsQueryKey } from "../../lib/dashboards";

/**
 * Setup-wizard step 0: pick your deployment type up front. Each card is a PRESET for a
 * customer type — what it relaxes, the env it suggests, and what to do next — so an SME,
 * charity or self-hoster doesn't have to wear the enterprise weight by default. Selecting
 * persists the profile (admin); infra-level env (DEPLOYMENT_PROFILE) stays authoritative on
 * a fresh boot.
 *
 * Below the cards, a single "We're a charity" button applies the whole charity onboarding
 * preset in one click (profile + trustee/funder dashboards + best-effort nomenclature) —
 * a shortcut over choosing the nonprofit card and separately building those dashboards by hand.
 */
export function ProfileStep({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data } = useDeploymentProfile();
  const [charityState, setCharityState] = useState<
    { status: "idle" } | { status: "pending" } | { status: "done"; result: CharityOnboardingResult } | { status: "error"; message: string }
  >({ status: "idle" });

  const choose = async (profile: string): Promise<void> => {
    if (!isAdmin || profile === data?.profile) return;
    try { await setDeploymentProfile(profile); await qc.invalidateQueries({ queryKey: ["deployment-profile"] }); }
    catch { /* surfaced by the unchanged selection */ }
  };

  const applyCharity = async (): Promise<void> => {
    if (!isAdmin) return;
    setCharityState({ status: "pending" });
    try {
      const result = await applyCharityOnboarding();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["deployment-profile"] }),
        qc.invalidateQueries({ queryKey: dashboardsQueryKey }),
      ]);
      setCharityState({ status: "done", result });
    } catch (err) {
      setCharityState({ status: "error", message: err instanceof Error ? err.message : "Could not apply the charity preset." });
    }
  };

  if (!data?.catalogue) return null;

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

      <div className="mt-4 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3" data-testid="charity-onboarding">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold">We're a charity</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              One click: switches to the non-profit profile, adds a trustee report and a funder
              report to your dashboards, and adopts your backend's wording if it has one.
            </p>
          </div>
          <button
            type="button"
            disabled={!isAdmin || charityState.status === "pending"}
            data-testid="charity-onboarding-apply"
            onClick={() => void applyCharity()}
            className={`shrink-0 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded border border-primary bg-primary text-primary-foreground ${!isAdmin || charityState.status === "pending" ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"}`}
          >
            {charityState.status === "pending" ? "Setting up…" : "We're a charity — set up in one click"}
          </button>
        </div>
        {charityState.status === "done" && (
          <p className="mt-2 text-xs text-green-700" role="status">
            Done — profile set to {charityState.result.posture.label}
            {charityState.result.dashboardsAdded.length > 0
              ? `, added ${charityState.result.dashboardsAdded.map((d) => d.name).join(" + ")}`
              : ", trustee/funder dashboards were already there"}
            {charityState.result.nomenclature.applied ? ", adopted your backend's wording" : ""}.
          </p>
        )}
        {charityState.status === "error" && (
          <p className="mt-2 text-xs text-red-600" role="alert">{charityState.message}</p>
        )}
      </div>
    </section>
  );
}
