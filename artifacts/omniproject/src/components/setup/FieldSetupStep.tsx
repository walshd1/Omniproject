import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Step } from "./shared";
import { usePickableFields } from "../../lib/pickable-fields";
import { useFieldRouting, useSaveFieldRouting, identityRouting } from "../../lib/routing";

/**
 * Field setup step — the wizard's shortcut into routing. It shows the CURRENT STATE (what your wired
 * backends advertise, and how much is already mapped), then offers the sensible default: a
 * one-to-one-to-one mapping — each field routed to a source of the same name through one vendor + one
 * broker. Existing routes are preserved (only unmapped fields are seeded), so it's safe to click, and
 * the seed is always collision-free. Fine-tuning, custom fields and validation live in the full
 * Routing matrix (linked). Admin-only.
 */
export function FieldSetupStep({ n, isAdmin, backendId }: { n: number; isAdmin: boolean; backendId?: string }) {
  const pickable = usePickableFields();
  const { data: routes } = useFieldRouting();
  const save = useSaveFieldRouting();
  const { toast } = useToast();
  const [vendor, setVendor] = useState(backendId ?? "");
  // Broker-neutral: the admin names the broker they wired (the seed stays disabled until they do).
  const [broker, setBroker] = useState("");

  if (!isAdmin) return null;

  const existing = routes ?? [];
  const seed = identityRouting(pickable.fields, vendor, broker, existing);
  const toAdd = seed.length - existing.length;
  const canSeed = !!vendor.trim() && !!broker.trim() && toAdd > 0;

  const onSeed = () => {
    save.mutate(seed, {
      onSuccess: () => toast({ title: "FIELDS MAPPED", description: `${toAdd} field(s) mapped one-to-one.` }),
      onError: (e) => toast({ title: "COULD NOT MAP", description: e instanceof Error ? e.message : "Check the routing matrix.", variant: "destructive" }),
    });
  };

  return (
    <Step n={n} title="Field setup">
      <p className="text-sm text-muted-foreground">
        Decide which fields OmniProject shows and where each one comes from. The default is a
        <strong> one-to-one-to-one</strong> mapping — every field routed to a source of the same name,
        through one vendor and one broker. You can fine-tune any of it afterwards.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border border-border p-3" data-testid="field-setup-state">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Available now</div>
          <div className="font-bold text-sm">
            {pickable.restricted ? `${pickable.advertised.length} advertised` : "Full superset"}
          </div>
          <div className="text-xs text-muted-foreground">
            {pickable.mapped.length} already mapped
            {pickable.custom.length > 0 && ` · ${pickable.custom.length} custom`}
          </div>
        </div>
        <div className="border border-border p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">1:1:1 default</div>
          <div className="font-bold text-sm">{toAdd > 0 ? `${toAdd} field(s) to map` : "All mapped"}</div>
          <div className="text-xs text-muted-foreground">preserves your existing routes</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Vendor</span>
          <Input aria-label="Default vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. your backend id" className="h-8 w-40" />
        </label>
        <label className="text-xs">
          <span className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Broker</span>
          <Input aria-label="Default broker" value={broker} onChange={(e) => setBroker(e.target.value)} className="h-8 w-32" />
        </label>
        <Button type="button" size="sm" onClick={onSeed} disabled={!canSeed || save.isPending} data-testid="field-setup-seed">
          {save.isPending ? "MAPPING…" : `Map ${toAdd > 0 ? toAdd : ""} field(s) 1:1:1`}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Going beyond what your backends advertise — adding a custom field, or routing through the Postgres
        sidecar — is a deliberate step. Do all of it, plus renaming labels and validation rules, in{" "}
        <Link href="/settings" className="font-medium underline" data-testid="field-setup-settings-link">Settings → Field routing</Link>.
      </p>
    </Step>
  );
}
