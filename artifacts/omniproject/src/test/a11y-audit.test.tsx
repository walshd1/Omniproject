import { describe, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "./utils";
import { expectNoAxe } from "./a11y";
import { Login } from "../pages/Login";
import { ReportTable, type ReportColumn } from "../components/reports/ReportTable";
import { EditableRowTable, type EditableColumn } from "../components/settings/EditableRowTable";
import { AdminSection } from "../components/settings/AdminSection";
import { StatTile } from "../components/tiles/StatTile";
import { Badge } from "../components/tiles/Badge";
import { DataQualityBadge } from "../components/DataQualityBadge";
import { useDataQuality } from "../lib/data-quality";
import { Boxes } from "lucide-react";

/**
 * AUTOMATED WCAG 2.0/2.1/2.2 A+AA audit (axe-core) over a representative cross-section of the app's UI
 * patterns — auth form, data tables, editable admin grids, section shells, stat tiles. Catches the
 * structural criteria (names/roles/values, labels, landmarks, list/heading structure, ARIA validity)
 * and gates against regressions. Layout-dependent criteria (contrast, target size, reflow) are covered
 * by the browser Playwright axe job + the manual audit in docs/ACCESSIBILITY-CONFORMANCE.md.
 */

interface R { id: string; name: string; amount: number }
const ROWS: R[] = [{ id: "a", name: "Alpha", amount: 10 }, { id: "b", name: "Beta", amount: 20 }];
const COLS: ReportColumn<R>[] = [
  { header: "Name", cell: (r) => r.name },
  { header: "Amount", align: "right", cell: (r) => `£${r.amount}` },
];
const EDIT_COLS: EditableColumn<R>[] = [
  { header: "Name", cell: (r, i) => <input aria-label={`Name ${i + 1}`} defaultValue={r.name} /> },
];

function seededClient(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: false });
  qc.setQueryData(["auth", "providers"], []);
  return qc;
}

describe("WCAG 2.2 A/AA automated audit", () => {
  it("Login (auth form)", async () => {
    const { container } = renderWithProviders(<Login />, { client: seededClient() });
    await expectNoAxe(container);
  });

  it("ReportTable (data table)", async () => {
    const { container } = renderWithProviders(
      <ReportTable columns={COLS} rows={ROWS} rowKey={(r) => r.id} rowTestId={(r) => `row-${r.id}`} />,
    );
    await expectNoAxe(container);
  });

  it("EditableRowTable (editable admin grid)", async () => {
    const { container } = renderWithProviders(
      <EditableRowTable columns={EDIT_COLS} rows={ROWS} rowKey={(_, i) => i} onRemove={() => {}} removeLabel={(i) => `Remove ${i + 1}`} emptyText="None." />,
    );
    await expectNoAxe(container);
  });

  it("AdminSection (section shell)", async () => {
    const { container } = renderWithProviders(
      <AdminSection icon={Boxes} title="Programmes" testId="x"><button>Add</button></AdminSection>,
    );
    await expectNoAxe(container);
  });

  it("StatTile (KPI tile)", async () => {
    const { container } = renderWithProviders(<StatTile label="Budget" value="£1,000" hint="of plan" />);
    await expectNoAxe(container);
  });

  it("Badge status tones (RAG/flag chip)", async () => {
    const { container } = renderWithProviders(
      <div>
        <Badge tone="good">5 OK</Badge>
        <Badge tone="warn">2 AT</Badge>
        <Badge tone="bad">1 CR</Badge>
        <Badge tone="info">info</Badge>
      </div>,
    );
    await expectNoAxe(container);
  });

  it("DataQualityBadge (live-region status)", async () => {
    useDataQuality.setState({ everRepaired: true, lastRepaired: 3 });
    const { container } = renderWithProviders(<DataQualityBadge />);
    await expectNoAxe(container);
    useDataQuality.setState({ everRepaired: false, lastRepaired: 0 });
  });

  it("labelled native select (form control)", async () => {
    const { container } = renderWithProviders(
      <div>
        <label htmlFor="ccy">Display currency</label>
        <select id="ccy" defaultValue="GBP"><option value="GBP">GBP</option><option value="USD">USD</option></select>
      </div>,
    );
    await expectNoAxe(container);
  });
});
