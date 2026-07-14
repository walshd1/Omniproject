import type { SettingsState } from "./settings";

/**
 * Known-good settings blueprints for common customer archetypes — a starting point an operator LOADS in
 * the setup wizard / configurator and then tweaks, instead of configuring a bare deployment field by
 * field. Each preset is a small `Partial<SettingsState>` of the high-level posture knobs (deployment
 * profile, financial rigour, prioritisation emphasis, on-device vs external AI, lean vs full modules);
 * everything it doesn't set keeps the code defaults.
 *
 * INVARIANT: every preset is a valid combination — it passes the cross-field constraint registry
 * (lib/settings-constraints) and the settings validator. A settings-presets test enforces this, so a
 * blueprint can never ship an illegal combo the constraint layer would reject. Presets deliberately set
 * no secrets/elevations (no capabilityStates/webhooks/AI keys) — AI stays "none" until the operator
 * supplies their own credentials.
 */
export interface SettingsPreset {
  id: string;
  label: string;
  /** Who this blueprint is for (shown as "For: …"). */
  audience: string;
  description: string;
  /** The posture this blueprint applies; merged over the current settings when loaded. */
  settings: Partial<SettingsState>;
}

const PRESETS: SettingsPreset[] = [
  {
    id: "enterprise-pmo",
    label: "Enterprise PMO",
    audience: "Large enterprises with a formal PMO and portfolio governance",
    description:
      "Portfolio-grade rigour: enterprise profile, period-close FX for clean board-pack variance, and a strategy-weighted prioritisation. Governance controls are ready to layer on; AI stays off until you connect a provider.",
    settings: {
      deploymentProfile: "enterprise",
      reportingCurrency: "USD",
      fxRatePolicy: "periodClose",
      aiProvider: "none",
      sttProvider: "browser",
      priorityWeights: { rice: 15, wsjf: 15, moscow: 15, strategic: 35, benefit: 20 },
    },
  },
  {
    id: "growth-business",
    label: "Growth Business",
    audience: "Scaling companies delivering with agile squads",
    description:
      "Velocity-first: business profile, live spot FX, and a RICE/WSJF-weighted backlog. Lean governance, all modules on so teams can adopt dashboards and integrations as they grow.",
    settings: {
      deploymentProfile: "business",
      reportingCurrency: "USD",
      fxRatePolicy: "spot",
      aiProvider: "none",
      sttProvider: "browser",
      priorityWeights: { rice: 35, wsjf: 30, moscow: 15, strategic: 10, benefit: 10 },
    },
  },
  {
    id: "nonprofit",
    label: "Nonprofit / NGO",
    audience: "Charities and NGOs focused on outcomes over throughput",
    description:
      "Impact-led and lean: nonprofit profile, benefit/strategy-weighted prioritisation, and the heavier OData + external-integration modules switched off to keep the surface small. Turn them back on any time.",
    settings: {
      deploymentProfile: "nonprofit",
      reportingCurrency: "USD",
      fxRatePolicy: "spot",
      aiProvider: "none",
      sttProvider: "browser",
      priorityWeights: { rice: 15, wsjf: 10, moscow: 15, strategic: 25, benefit: 35 },
      disabledFeatures: ["odata", "integrations"],
    },
  },
  {
    id: "agency-services",
    label: "Agency / Professional Services",
    audience: "Agencies and consultancies running client-billable delivery",
    description:
      "Client-billable delivery: budget-rate FX so margin isn't polluted by day-to-day drift, a value/benefit-weighted backlog, and the comments + grid collaboration modules to the fore.",
    settings: {
      deploymentProfile: "business",
      reportingCurrency: "USD",
      fxRatePolicy: "budgetRate",
      aiProvider: "none",
      sttProvider: "browser",
      priorityWeights: { rice: 20, wsjf: 20, moscow: 10, strategic: 20, benefit: 30 },
    },
  },
  {
    id: "regulated-selfhost",
    label: "Regulated / Self-hosted",
    audience: "Regulated or air-gap-leaning orgs that self-host and minimise egress",
    description:
      "Minimal external surface: self-hosted profile, on-device speech only, no external integrations, and period-close FX. AI stays off; enable a LOCAL provider (Ollama) if you want it without egress.",
    settings: {
      deploymentProfile: "self-hosted",
      reportingCurrency: "USD",
      fxRatePolicy: "periodClose",
      aiProvider: "none",
      sttProvider: "browser",
      priorityWeights: { rice: 20, wsjf: 20, moscow: 20, strategic: 25, benefit: 15 },
      disabledFeatures: ["integrations"],
    },
  },
  {
    id: "demo-trial",
    label: "Demo / Trial",
    audience: "Evaluators exploring the product with the built-in demo data",
    description:
      "Everything on for exploration: demo profile, default prioritisation, on-device speech. No reporting currency so FX stays out of the way until you're ready.",
    settings: {
      deploymentProfile: "demo",
      reportingCurrency: null,
      fxRatePolicy: "spot",
      aiProvider: "none",
      sttProvider: "browser",
    },
  },
];

/** The known-good settings blueprints, newest posture first (stable order). */
export function listSettingsPresets(): SettingsPreset[] {
  return PRESETS;
}

/** One blueprint by id, or null. */
export function settingsPreset(id: string): SettingsPreset | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}
