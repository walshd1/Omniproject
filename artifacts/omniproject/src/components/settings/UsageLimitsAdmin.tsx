import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast } from "../../lib/auth";
import {
  useUsageReport, useUsagePolicies, saveUsagePolicies, runUsageNotify,
  type UsagePolicy, type WarningLevel, type Granularity, type Metric, type VendorUsage,
} from "../../lib/usage";

/**
 * External-API usage & limits admin. Surfaces each vendor's call/token volume by HOUR / DAY / MONTH,
 * plus cost where configured, and lets an admin enter an optional per-vendor volume limit + unit cost.
 * A limit drives a warning band at 50 / 75 / 90 / 100% of the period's usage; "Notify me" pushes the
 * current status as a notification. pmo/admin only.
 */
const LEVEL_CLS: Record<WarningLevel, string> = {
  ok: "bg-muted text-muted-foreground",
  notice: "bg-yellow-100 text-yellow-800",
  warn: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
  over: "bg-red-200 text-red-900",
};
const PERIODS: Granularity[] = ["hour", "day", "month"];
const METRICS: Metric[] = ["calls", "tokens"];
const COST_PER = ["call", "token", "ktoken"] as const;

const num = (n: number): string => n.toLocaleString();

export function UsageLimitsAdmin() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data: report } = useUsageReport();
  const { data: policiesData } = useUsagePolicies();

  const [draft, setDraft] = useState<Record<string, UsagePolicy> | null>(null);
  const [newVendor, setNewVendor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // The editable policy map: the local draft once touched, else the loaded server value.
  const policies = draft ?? policiesData?.usagePolicies ?? {};
  const usageByVendor = useMemo(() => {
    const m = new Map<string, VendorUsage>();
    for (const v of report?.vendors ?? []) m.set(v.vendor, v);
    return m;
  }, [report]);

  if (!roleAtLeast(auth?.role, "pmo") && !roleAtLeast(auth?.role, "admin")) return null;

  const vendors = [...new Set([...(report?.vendors ?? []).map((v) => v.vendor), ...Object.keys(policies)])].sort();

  const edit = (vendor: string, patch: (p: UsagePolicy) => UsagePolicy): void => {
    setDraft({ ...policies, [vendor]: patch(policies[vendor] ?? {}) });
  };
  const setLimit = (vendor: string, key: "period" | "metric" | "max", value: string): void =>
    edit(vendor, (p) => {
      const limit = { period: "day", metric: "calls", max: 0, ...p.limit } as NonNullable<UsagePolicy["limit"]>;
      const next = key === "max" ? { ...limit, max: Number(value) || 0 } : { ...limit, [key]: value } as NonNullable<UsagePolicy["limit"]>;
      const { limit: _drop, ...rest } = p;
      return next.max > 0 ? { ...rest, limit: next } : rest; // max 0 ⇒ omit the limit entirely
    });
  const setCost = (vendor: string, key: "per" | "amount" | "currency", value: string): void =>
    edit(vendor, (p) => {
      const cost = { per: "call", amount: 0, currency: "USD", ...p.cost } as NonNullable<UsagePolicy["cost"]>;
      const next = key === "amount" ? { ...cost, amount: Number(value) || 0 } : { ...cost, [key]: value } as NonNullable<UsagePolicy["cost"]>;
      const { cost: _drop, ...rest } = p;
      return next.amount > 0 && next.currency ? { ...rest, cost: next } : rest; // amount 0 ⇒ omit the cost
    });

  const addVendor = (): void => {
    const v = newVendor.trim().toLowerCase();
    if (!v) return;
    setDraft({ ...policies, [v]: policies[v] ?? {} });
    setNewVendor("");
  };

  const onSave = async (): Promise<void> => {
    setBusy(true); setError(null); setStatus(null);
    try {
      await saveUsagePolicies(policies);
      await qc.invalidateQueries({ queryKey: ["usage-policies"] });
      await qc.invalidateQueries({ queryKey: ["usage-report"] });
      setDraft(null);
      setStatus("Saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const onNotify = async (): Promise<void> => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const r = await runUsageNotify();
      setStatus(r.worst === "ok" ? "All vendors within limits — notification sent." : `${r.flagged.length} vendor(s) flagged — notification sent.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Notify failed"); }
    finally { setBusy(false); }
  };

  const inputCls = "rounded border border-border bg-background px-2 py-1 text-sm";

  return (
    <Card data-testid="usage-limits">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          API usage &amp; limits
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onNotify()} data-testid="usage-notify">Notify me</Button>
            {draft && <Button size="sm" disabled={busy} onClick={() => void onSave()} data-testid="usage-save">{busy ? "Saving…" : "Save changes"}</Button>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Call &amp; token volume OmniProject sends to each external vendor (AI providers and connected
          backends), by hour, day and month. Enter an optional volume limit + unit cost per vendor —
          a limit warns at 50 / 75 / 90 / 100% of the period's usage.
        </p>
        {error && <p className="text-sm text-red-600" data-testid="usage-error">{error}</p>}
        {status && <p className="text-sm text-green-700" data-testid="usage-status">{status}</p>}

        {vendors.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="usage-empty">
            No external API usage recorded yet. Add a vendor below to pre-set a limit or cost.
          </p>
        ) : (
          <ul className="space-y-4" data-testid="usage-vendors">
            {vendors.map((vendor) => {
              const u = usageByVendor.get(vendor);
              const p = policies[vendor] ?? {};
              const limit = u?.limit ?? null;
              return (
                <li key={vendor} className="rounded border border-border p-3 space-y-2" data-testid={`usage-vendor-${vendor}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{vendor}</span>
                    {limit && (
                      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${LEVEL_CLS[limit.level]}`} data-testid={`usage-badge-${vendor}`}>
                        {Math.round(limit.fraction * 100)}% of {limit.period} {limit.metric} ({num(limit.used)}/{num(limit.max)})
                      </span>
                    )}
                  </div>

                  {/* Totals by hour / day / month */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {PERIODS.map((g) => (
                      <div key={g} className="rounded bg-muted/50 px-2 py-1">
                        <div className="uppercase tracking-wide text-muted-foreground">{g}</div>
                        <div>{num(u?.totals?.[g]?.calls ?? 0)} calls</div>
                        <div>{num(u?.totals?.[g]?.tokens ?? 0)} tokens</div>
                      </div>
                    ))}
                  </div>
                  {u?.cost && (
                    <p className="text-xs text-muted-foreground" data-testid={`usage-cost-${vendor}`}>
                      Cost: {u.cost.currency} {u.cost.day.toFixed(2)} today · {u.cost.currency} {u.cost.month.toFixed(2)} this month
                    </p>
                  )}

                  {/* Editable limit + cost */}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="text-muted-foreground">Limit</label>
                    <select className={inputCls} aria-label={`${vendor} limit period`} value={p.limit?.period ?? "day"} onChange={(e) => setLimit(vendor, "period", e.target.value)}>
                      {PERIODS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <select className={inputCls} aria-label={`${vendor} limit metric`} value={p.limit?.metric ?? "calls"} onChange={(e) => setLimit(vendor, "metric", e.target.value)}>
                      {METRICS.map((mt) => <option key={mt} value={mt}>{mt}</option>)}
                    </select>
                    <input className={`${inputCls} w-24`} type="number" min={0} aria-label={`${vendor} limit max`} placeholder="max (0=off)" value={p.limit?.max ?? ""} onChange={(e) => setLimit(vendor, "max", e.target.value)} />
                    <span className="mx-1 text-border">|</span>
                    <label className="text-muted-foreground">Cost</label>
                    <input className={`${inputCls} w-24`} type="number" min={0} step="any" aria-label={`${vendor} cost amount`} placeholder="amount" value={p.cost?.amount ?? ""} onChange={(e) => setCost(vendor, "amount", e.target.value)} />
                    <select className={inputCls} aria-label={`${vendor} cost per`} value={p.cost?.per ?? "call"} onChange={(e) => setCost(vendor, "per", e.target.value)}>
                      {COST_PER.map((c) => <option key={c} value={c}>per {c === "ktoken" ? "1k tokens" : c}</option>)}
                    </select>
                    <input className={`${inputCls} w-16`} aria-label={`${vendor} cost currency`} placeholder="USD" value={p.cost?.currency ?? ""} onChange={(e) => setCost(vendor, "currency", e.target.value)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <input className={inputCls} aria-label="Add vendor" placeholder="Add a vendor (e.g. openai)" value={newVendor} onChange={(e) => setNewVendor(e.target.value)} data-testid="usage-add-input" />
          <Button size="sm" variant="outline" onClick={addVendor} data-testid="usage-add">Add vendor</Button>
        </div>
      </CardContent>
    </Card>
  );
}
