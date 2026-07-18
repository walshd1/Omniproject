/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { type BrandingConfig } from "./settings";
import { isEntitled } from "./license";
import { artifactStoreEnabled, makeScopedId } from "./artifact-store";
import { getDef, putDef, deleteDef, type StoredDef } from "./def-import";

/**
 * White-label branding (premium feature `branding`).
 *
 * The product defaults are "OmniProject" / "OP". When the `branding`
 * entitlement is present an operator can override the app name, short badge,
 * logo, accent colour and login/footer text. If the licence lapses, branding
 * reverts to the defaults automatically (the override is kept but not served).
 *
 * STORAGE: branding is a `branding` config def at ORG scope (NOT a settings key) — it rides the sealed def
 * store + the def backup like every other config in the composition model. Beneath the org override sits the
 * DEPLOY DEFAULT from `BRAND_*` env vars (a first-class deploy-time source, e.g. a helm chart), and beneath that
 * the product defaults. So the resolution order is: org config def → env default → product default.
 */

const BRANDING_CONFIG_ID = "branding";
const ORG_BRANDING_ID = makeScopedId("org", `config-${BRANDING_CONFIG_ID}`);

/** The deploy-time branding default from `BRAND_*` env vars (null when none set). */
export function brandingFromEnv(): BrandingConfig | null {
  const b: BrandingConfig = {
    appName: process.env["BRAND_APP_NAME"]?.trim() || null,
    shortName: process.env["BRAND_SHORT_NAME"]?.trim() || null,
    logoUrl: process.env["BRAND_LOGO_URL"]?.trim() || null,
    primaryColor: process.env["BRAND_PRIMARY_COLOR"]?.trim() || null,
    loginHeading: process.env["BRAND_LOGIN_HEADING"]?.trim() || null,
    footerText: process.env["BRAND_FOOTER_TEXT"]?.trim() || null,
    supportUrl: process.env["BRAND_SUPPORT_URL"]?.trim() || null,
    fontFamily: process.env["BRAND_FONT_FAMILY"]?.trim() || null,
  };
  return Object.values(b).some(Boolean) ? b : null;
}

/** The stored org branding override (the config def's values), or null when unset / no store. Sanitised on
 *  READ through the SAME guard as `saveBranding` (font-stack / URL / colour / length caps): the generic
 *  config-def importer has no branding-specific validator, so a value that entered the store via a
 *  restored/tampered BACKUP is normalised here before it can reach the inline style. A value that fails the
 *  guard is rejected (→ null → falls back to the env/product default), never rendered. */
function orgBranding(): BrandingConfig | null {
  if (!artifactStoreEnabled()) return null;
  const v = (getDef({ kind: "org" }, ORG_BRANDING_ID)?.payload as { values?: unknown } | undefined)?.values;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  try { return sanitizeBranding(v); } catch { return null; }
}

export const DEFAULT_BRANDING: Required<BrandingConfig> = {
  appName: "OmniProject",
  shortName: "OP",
  logoUrl: "",
  primaryColor: "",
  loginHeading: "Orchestration Shell",
  footerText: "",
  supportUrl: "",
  fontFamily: "",
};

export interface EffectiveBranding extends Required<BrandingConfig> {
  /** True when the `branding` entitlement is active. */
  entitled: boolean;
  /** True when overrides exist but are suppressed because it isn't entitled. */
  locked: boolean;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Validate + normalise an incoming branding patch. Throws on bad input. */
export function sanitizeBranding(input: unknown): BrandingConfig {
  if (!input || typeof input !== "object") throw new Error("branding must be an object");
  const o = input as Record<string, unknown>;
  const str = (k: string, max = 200): string | null => {
    const v = o[k];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string") throw new Error(`${k} must be a string`);
    if (v.length > max) throw new Error(`${k} is too long (max ${max})`);
    return v.trim();
  };
  const url = (k: string): string | null => {
    const v = str(k, 2000);
    if (v && !/^https?:\/\//i.test(v)) throw new Error(`${k} must be an absolute http(s) URL`);
    return v;
  };
  const color = str("primaryColor", 32);
  if (color && !HEX.test(color)) throw new Error("primaryColor must be a hex colour like #2563eb");
  // Font family: a safe CSS font stack — letters/spaces/quotes/commas/hyphens only,
  // so it can't smuggle a value into the inline style we set.
  const fontFamily = str("fontFamily", 200);
  if (fontFamily && !/^[\w \-'",]+$/.test(fontFamily)) throw new Error("fontFamily may contain only letters, spaces, quotes, commas and hyphens");

  return {
    appName: str("appName", 60),
    shortName: str("shortName", 6),
    logoUrl: url("logoUrl"),
    primaryColor: color,
    loginHeading: str("loginHeading", 120),
    footerText: str("footerText", 240),
    supportUrl: url("supportUrl"),
    fontFamily,
  };
}

/** The branding the UI should render right now (defaults unless entitled). The override is the org config def,
 *  falling back to the `BRAND_*` env default; both sit beneath the product defaults. */
export function effectiveBranding(): EffectiveBranding {
  const entitled = isEntitled("branding");
  const override = orgBranding() ?? brandingFromEnv();
  const hasOverride = !!override && Object.values(override).some(Boolean);
  const merged = entitled && override
    ? {
        appName: override.appName || DEFAULT_BRANDING.appName,
        shortName: override.shortName || DEFAULT_BRANDING.shortName,
        logoUrl: override.logoUrl || DEFAULT_BRANDING.logoUrl,
        primaryColor: override.primaryColor || DEFAULT_BRANDING.primaryColor,
        loginHeading: override.loginHeading || DEFAULT_BRANDING.loginHeading,
        footerText: override.footerText || DEFAULT_BRANDING.footerText,
        supportUrl: override.supportUrl || DEFAULT_BRANDING.supportUrl,
        fontFamily: override.fontFamily || DEFAULT_BRANDING.fontFamily,
      }
    : { ...DEFAULT_BRANDING };
  return { ...merged, entitled, locked: hasOverride && !entitled };
}

/** Persist branding overrides as the org `branding` config def (callers must enforce the entitlement). */
export function saveBranding(input: unknown): BrandingConfig {
  const branding = sanitizeBranding(input);
  const payload = { id: BRANDING_CONFIG_ID, values: branding };
  const existing = getDef({ kind: "org" }, ORG_BRANDING_ID);
  const now = new Date().toISOString();
  const row: StoredDef = existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : { id: ORG_BRANDING_ID, kind: "config", name: "Branding", payload, createdBy: null, createdAt: now, updatedAt: now, rowVersion: 1 };
  putDef({ kind: "org" }, row);
  return branding;
}

/** Reset white-label branding back to the deploy/product defaults (remove the org override def). */
export function clearBranding(): void {
  deleteDef({ kind: "org" }, ORG_BRANDING_ID);
}