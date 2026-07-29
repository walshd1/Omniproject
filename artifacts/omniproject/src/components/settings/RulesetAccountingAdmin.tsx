import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sendJson } from "../../lib/api";
import {
  useRulesetAccounting, rulesetAccountingKey, ACCOUNTING_ACCOUNT_FIELDS, DEPRECIATION_METHODS,
  DEPRECIATION_METHOD_LABELS, isValidAccountCode, isValidDbFactor,
  type AccountingAccounts, type DepreciationMethod,
} from "../../lib/ruleset-accounting";

/**
 * Accounting policy — the finance-CONFIG facet of the business-ruleset governance (chart-of-accounts codes + the
 * depreciation policy the fixed-asset engine applies). Not a standalone settings panel: it is a section of the
 * ruleset/methodology governance surface (PMO authority), reading `GET /api/admin/ruleset/accounting` and writing
 * `PUT /api/admin/ruleset/accounting`. Programme/project overrides ride the ruleset scope-override editor above.
 */

const EMPTY_ACCOUNTS: AccountingAccounts = {
  depreciationExpense: "", accumulatedDepreciation: "", assetCost: "", disposalProceeds: "", gainLossOnDisposal: "",
};

export function RulesetAccountingAdmin() {
  const { data } = useRulesetAccounting();
  const raw = data?.accounting;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<AccountingAccounts>(EMPTY_ACCOUNTS);
  const [factor, setFactor] = useState("2");
  const [method, setMethod] = useState<DepreciationMethod>("straight_line");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!raw) return;
    if (raw.accounts) setAccounts({ ...EMPTY_ACCOUNTS, ...raw.accounts });
    if (typeof raw.decliningBalanceFactor === "number") setFactor(String(raw.decliningBalanceFactor));
    if (raw.defaultDepreciationMethod) setMethod(raw.defaultDepreciationMethod);
  }, [raw]);

  const setAccount = (key: keyof AccountingAccounts, value: string) =>
    setAccounts((prev) => ({ ...prev, [key]: value }));

  const factorNum = Number(factor);
  const codesValid = ACCOUNTING_ACCOUNT_FIELDS.every((f) => isValidAccountCode(accounts[f.key].trim()));
  const valid = codesValid && isValidDbFactor(factorNum);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const trimmed: AccountingAccounts = {
      depreciationExpense: accounts.depreciationExpense.trim(),
      accumulatedDepreciation: accounts.accumulatedDepreciation.trim(),
      assetCost: accounts.assetCost.trim(),
      disposalProceeds: accounts.disposalProceeds.trim(),
      gainLossOnDisposal: accounts.gainLossOnDisposal.trim(),
    };
    try {
      await sendJson("/api/admin/ruleset/accounting", { accounts: trimmed, decliningBalanceFactor: factorNum, defaultDepreciationMethod: method }, "PUT");
      queryClient.invalidateQueries({ queryKey: rulesetAccountingKey });
      const set = ACCOUNTING_ACCOUNT_FIELDS.filter((f) => accounts[f.key].trim()).length;
      toast({ title: "ACCOUNTING POLICY SAVED", description: `${set}/${ACCOUNTING_ACCOUNT_FIELDS.length} accounts · ${factorNum}× DB · ${DEPRECIATION_METHOD_LABELS[method]}` });
    } catch {
      toast({ title: "COULD NOT SAVE", description: "Check the values and try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-testid="ruleset-accounting" className="mt-8">
      <div className="flex items-center gap-3 mb-4">
        <Landmark className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Accounting policy</h2>
      </div>

      <div className="bg-card border border-border p-4 space-y-5">
        <p className="text-xs text-muted-foreground">
          The general-ledger accounts finance postings map onto, and the depreciation policy the fixed-asset
          engine applies — a governance facet alongside the business rules above. A programme or project can
          override it via the scope editor. Leave an account blank until you know its code; a depreciation posting
          can't run until the accounts it needs are set.
        </p>

        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">GL account codes</div>
          <div className="space-y-2">
            {ACCOUNTING_ACCOUNT_FIELDS.map((f) => {
              const value = accounts[f.key];
              const bad = !isValidAccountCode(value.trim());
              return (
                <div key={f.key} className="flex items-center gap-3">
                  <label htmlFor={`acct-${f.key}`} className="text-xs text-muted-foreground w-48">{f.label}</label>
                  <input
                    id={`acct-${f.key}`}
                    data-testid={`acct-${f.key}`}
                    type="text"
                    value={value}
                    placeholder="unset"
                    onChange={(e) => setAccount(f.key, e.target.value)}
                    className={`w-40 border bg-background px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring ${bad ? "border-red-600" : "border-border"}`}
                  />
                  {bad && <span className="text-[11px] text-red-600">invalid code</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="acct-db-factor" className="text-xs font-bold uppercase tracking-widest text-muted-foreground w-48">Declining-balance factor</label>
          <input
            id="acct-db-factor"
            data-testid="acct-db-factor"
            type="number"
            min={1}
            max={4}
            step={0.25}
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            className="w-24 border border-border bg-background px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-[11px] text-muted-foreground">2 = 200% (double-declining), 1.5 = 150%</span>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="acct-method" className="text-xs font-bold uppercase tracking-widest text-muted-foreground w-48">Default depreciation method</label>
          <select
            id="acct-method"
            data-testid="acct-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as DepreciationMethod)}
            className="border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {DEPRECIATION_METHODS.map((m) => <option key={m} value={m}>{DEPRECIATION_METHOD_LABELS[m]}</option>)}
          </select>
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || saving}
            data-testid="acct-save"
            className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {saving ? "SAVING…" : "Save accounting policy"}
          </button>
        </div>
      </div>
    </section>
  );
}
