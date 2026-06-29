import { useLicense } from "../lib/branding";
import { BrandingAdmin } from "./premium/BrandingAdmin";
import { LabelsAdmin } from "./premium/LabelsAdmin";
import { WebhooksAdmin } from "./premium/WebhooksAdmin";

/**
 * Premium overlay admin — a thin container that gates three independent, self-contained panels
 * (white-label branding, company nomenclature, outbound webhooks) on their licence entitlement
 * from /api/license. Each panel lives in its own file under ./premium.
 */
export function PremiumAdmin() {
  const { data: license } = useLicense();
  const has = (f: string) => !!license?.features.includes(f);

  return (
    <div className="space-y-8 mt-8">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <h1 className="text-2xl font-black uppercase tracking-tighter">Premium overlay</h1>
        {license && (
          <span className="text-xs font-mono uppercase tracking-widest border border-border px-2 py-1 text-muted-foreground">
            {license.valid ? `${license.tier}${license.expiresInDays != null ? ` · ${license.expiresInDays}d left` : ""}` : "Unlicensed"}
          </span>
        )}
      </div>
      <BrandingAdmin entitled={has("branding")} />
      <LabelsAdmin entitled={has("labels")} />
      <WebhooksAdmin entitled={has("webhooks")} />
    </div>
  );
}
