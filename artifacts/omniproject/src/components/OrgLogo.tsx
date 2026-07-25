import { useOrgIdentity } from "../lib/org-identity";

/**
 * The org's own logo, surfaced on a screen / report / export — but ONLY when the org has both provided a logo
 * AND opted to show it (`showLogo`). Renders nothing otherwise, so it's safe to drop anywhere a masthead/logo
 * slot exists. This is the org's asset for their deliverables (distinct from the premium product white-label).
 */
export function OrgLogo({ className = "", maxHeight = 32 }: { className?: string; maxHeight?: number | undefined }) {
  const org = useOrgIdentity();
  if (!org || !org.showLogo || !org.logo) return null;
  return (
    <img
      src={org.logo}
      alt={org.name ? `${org.name} logo` : "Organisation logo"}
      data-testid="org-logo"
      style={{ maxHeight, width: "auto" }}
      className={className}
    />
  );
}
