/**
 * Coverage guard — "every declared report is built". Binds each entry in the report catalogue
 * (lib/backend-catalogue/assets/reports/<id>.json) to a real, page-wired, tested implementation, so a
 * catalogue entry can never again drift away from its renderer (the gap the maturity audit found, where
 * six reports were offered but rendered nothing). A new report fails CI until it's wired + tested.
 *
 * This is the hand-wired-plane analogue of the data-driven drift guards: screens/views/methodologies
 * render through generic renderers (declared == built by construction), so only the bespoke report
 * components need this binding. Adding another hand-wired plane is one more `checkCoverage(...)` call.
 *
 * Run: pnpm --filter @workspace/scripts run guard-report-coverage
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCoverage, fsProbes, idsFromAssets, type Impl } from "./lib/coverage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

/**
 * How each report id is realised. A component name → a bespoke `components/reports/<name>.tsx` wired
 * into the Reports page; `surfacedVia` → the report is reached through another plane (e.g. a board
 * view), a deliberate, documented exception rather than a Reports-page card.
 */
const REPORT_IMPL: Record<string, Impl> = {
  "portfolio-rag": "PortfolioKpi",
  "resource-histogram": "ResourceHeatmap",
  "capacity-rollup": "CapacityRollup",
  evm: "FinancialEvmChart",
  "financial-summary": "FinancialSummary",
  "portfolio-financials": "PortfolioFinancials",
  "portfolio-income": "PortfolioIncome",
  "portfolio-benefits": "PortfolioBenefits",
  "income-invoicing": "IncomeInvoicing",
  "staff-cost": "StaffTimeCost",
  burndown: "Burndown",
  burnup: "Burnup",
  "cumulative-flow": "CumulativeFlow",
  velocity: "Velocity",
  "raid-register": "RaidRegister",
  gantt: { surfacedVia: "view", reason: "rendered as the Gantt board view, not a Reports-page card" },
};

const reportIds = idsFromAssets(path.join(ROOT, "lib/backend-catalogue/assets/reports"));
const probes = fsProbes(
  path.join(ROOT, "artifacts/omniproject/src/components/reports"),
  path.join(ROOT, "artifacts/omniproject/src/pages/Reports.tsx"),
);

const result = checkCoverage("reports", reportIds, REPORT_IMPL, probes);

if (!result.ok) {
  console.error("report-coverage guard: a declared report is not built/wired/tested.\n");
  for (const e of result.errors) console.error(`  - ${e}`);
  console.error("\n  Implement the report on the report primitives, wire it into Reports.tsx, add a test, and map it in REPORT_IMPL.");
  process.exit(1);
}
console.log(`report-coverage guard: OK — all ${reportIds.length} declared reports are built, wired and tested.`);
