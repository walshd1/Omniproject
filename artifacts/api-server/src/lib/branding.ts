/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by LICENSE-PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { getSettings, updateSettings, type BrandingConfig } from "./settings";
import { isEntitled } from "./license";

/**
 * White-label branding (premium feature `branding`).
 *
 * The product defaults are "OmniProject" / "OP". When the `branding`
 * entitlement is present an operator can override the app name, short badge,
 * logo, accent colour and login/footer text. If the licence lapses, branding
 * reverts to the defaults automatically (the override is kept but not served).
 *
 * Pure presentation config — stateless, carried in the settings store and
 * included in config snapshots.
 */

export const DEFAULT_BRANDING: Required<BrandingConfig> = {
  appName: "OmniProject",
  shortName: "OP",
  logoUrl: "",
  primaryColor: "",
  loginHeading: "Orchestration Shell",
  footerText: "",
  supportUrl: "",
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

  return {
    appName: str("appName", 60),
    shortName: str("shortName", 6),
    logoUrl: url("logoUrl"),
    primaryColor: color,
    loginHeading: str("loginHeading", 120),
    footerText: str("footerText", 240),
    supportUrl: url("supportUrl"),
  };
}

/** The branding the UI should render right now (defaults unless entitled). */
export function effectiveBranding(): EffectiveBranding {
  const entitled = isEntitled("branding");
  const override = getSettings().branding;
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
      }
    : { ...DEFAULT_BRANDING };
  return { ...merged, entitled, locked: hasOverride && !entitled };
}

/** Persist branding overrides (callers must enforce the entitlement). */
export function saveBranding(input: unknown): BrandingConfig {
  const branding = sanitizeBranding(input);
  updateSettings({ branding });
  return branding;
}

export function clearBranding(): void {
  updateSettings({ branding: null });
}