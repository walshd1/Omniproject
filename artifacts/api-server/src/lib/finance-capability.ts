/**
 * Finance record type → governed capability (Finance F0). Each finance record type belongs to exactly one of
 * the five finance sub-capabilities (`finance:ar` / `finance:ap` / `finance:gl` / `finance:banking` /
 * `finance:tax`), so a deployment can enable only the areas it uses. This is the single mapping table; the
 * route/broker enforcement seam looks a record type up here and calls `enforceCapability` on the result.
 *
 * Pure + exhaustive by construction (a finance record type without a home fails the coverage test), and it
 * returns `undefined` for every NON-finance record type so ordinary work items are never gated by finance.
 */

/** The five finance sub-capability ids, in AR→AP→GL→banking→tax order. */
export const FINANCE_CAPABILITY_IDS = ["finance:ar", "finance:ap", "finance:gl", "finance:banking", "finance:tax"] as const;
export type FinanceCapabilityId = (typeof FINANCE_CAPABILITY_IDS)[number];

/** Record type → its finance capability. The canonical, single source of truth for the partition. */
const RECORD_TYPE_TO_CAPABILITY: Readonly<Record<string, FinanceCapabilityId>> = {
  // AR — money owed to you.
  invoice: "finance:ar",
  payment: "finance:ar",
  credit_note: "finance:ar",
  quote: "finance:ar",
  recurring_invoice: "finance:ar",
  // AP — money you owe.
  bill: "finance:ap",
  expense: "finance:ap",
  purchase_order: "finance:ap",
  vendor: "finance:ap",
  // GL — the ledger + its masters.
  gl_account: "finance:gl",
  journal_entry: "finance:gl",
  fiscal_period: "finance:gl",
  dimension: "finance:gl",
  fixed_asset: "finance:gl",
  // Banking.
  bank_account: "finance:banking",
  bank_transaction: "finance:banking",
  // Tax.
  tax_rate: "finance:tax",
};

/** The finance capability that gates a record type, or `undefined` when the type is not a finance record
 *  (an ordinary work item — never gated by finance). */
export function financeCapabilityForRecordType(recordType: string): FinanceCapabilityId | undefined {
  return RECORD_TYPE_TO_CAPABILITY[recordType];
}

/** Whether a record type is a finance record (has a finance capability). */
export function isFinanceRecordType(recordType: string): boolean {
  return recordType in RECORD_TYPE_TO_CAPABILITY;
}

/**
 * The finance capability a broker action touches, parsed from a `<verb>_<recordType>` action name (e.g.
 * `create_bill`, `update_gl_account`, `list_tax_rates`), or `undefined` for a non-finance / unparseable
 * action. Best-effort: it strips a leading verb and an optional plural `s`, then maps the record type. An
 * action it can't parse yields `undefined` and passes UNGATED — finance governance is a feature toggle, not
 * an access-control boundary (RBAC + scope still apply), so failing open here only leaves a governance gate
 * incomplete, never opens a security hole.
 */
export function financeCapabilityForAction(action: string): FinanceCapabilityId | undefined {
  const m = /^[a-z]+_([a-z_]+?)s?$/.exec(action);
  return m ? financeCapabilityForRecordType(m[1]!) : undefined;
}

/** Every finance record type, grouped by capability — for tests + the admin surface. */
export function financeRecordTypesByCapability(): Record<FinanceCapabilityId, string[]> {
  const out = { "finance:ar": [], "finance:ap": [], "finance:gl": [], "finance:banking": [], "finance:tax": [] } as Record<FinanceCapabilityId, string[]>;
  for (const [type, cap] of Object.entries(RECORD_TYPE_TO_CAPABILITY)) out[cap].push(type);
  return out;
}
