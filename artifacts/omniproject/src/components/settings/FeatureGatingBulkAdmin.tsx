import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useListProjects, useListProgrammes } from "@workspace/api-client-react";
import { useAuth } from "../../lib/auth";
import { useFeatures, useScopeFeatureMaps, useSetProgrammeFeatures, useSetProjectFeatures } from "../../lib/features";
import {
  buildFeatureGatingExportRows,
  downloadFeatureGatingCsv,
  parseFeatureGatingCsv,
  diffGatingRow,
  type RowDiff,
  type RowIssue,
} from "../../lib/feature-gating-csv";

/**
 * Bulk feature-gating: export the full programme/project gating table as a CSV a PMO can edit in a
 * spreadsheet, then re-import it — a faster path than FeatureGovernance's one-scope-at-a-time form for
 * the "apply the same profile to 40 projects at once" case at real scale (e.g. 200 projects). Additive:
 * doesn't replace the per-scope editor. Import applies through the EXACT SAME `PUT
 * /features/programme|project/:id` routes the one-at-a-time UI uses (looped, sequentially so no two
 * writes race on the same read-modify-write settings patch) — so ownership/ceiling validation is
 * identical to a hand-edited single save, never bypassed for the bulk path.
 */
export function FeatureGatingBulkAdmin() {
  const { data: auth } = useAuth();
  const role = auth?.role;
  // Mirrors FeatureGovernance's own role gating exactly (the UI-level "representative role" check,
  // not the stricter server-side exact-authority gate) — the same admin session that sees the
  // programme/project tabs there sees the bulk tool here.
  const canProgramme = role === "pmo" || role === "admin";
  const canProject = role === "manager" || role === "pmo" || role === "admin";

  const { data: programmesData } = useListProgrammes();
  const { data: projectsData } = useListProjects();
  // A generated list hook can momentarily resolve to a non-array (loading/error/unexpected
  // payload); `?? []` only guards null/undefined, so narrow with Array.isArray.
  const programmes = Array.isArray(programmesData) ? programmesData : [];
  const projects = Array.isArray(projectsData) ? projectsData : [];
  // Org scope resolves the full catalogue (every id, regardless of scope-level state) — see
  // featureStatus() server-side, which always returns every governanceCatalogue() entry.
  const { data: catalogue } = useFeatures({});
  const { data: maps } = useScopeFeatureMaps();
  const setProg = useSetProgrammeFeatures();
  const setProj = useSetProjectFeatures();

  const [preview, setPreview] = useState<{ diffs: RowDiff[]; errors: RowIssue[]; warnings: RowIssue[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ applied: number; skipped: number; failed: { line: number; scopeId: string; message: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const validFeatureIds = useMemo(() => new Set((catalogue ?? []).map((f) => f.id)), [catalogue]);
  const knownProgrammeIds = useMemo(() => new Set(programmes.map((p) => p.id)), [programmes]);
  const knownProjectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);

  if (!canProject && !canProgramme) return null; // no scope this session can bulk-edit

  function doExport() {
    const rows = buildFeatureGatingExportRows(
      canProgramme ? programmes : [],
      canProject ? projects : [],
      maps?.programmeFeatures ?? {},
      maps?.projectFeatures ?? {},
    );
    downloadFeatureGatingCsv(rows);
  }

  async function importFile(file: File | undefined) {
    setParseError(null);
    setPreview(null);
    setResult(null);
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setParseError("Could not read that file.");
      return;
    }
    const { rows, errors, warnings } = parseFeatureGatingCsv(text, { validFeatureIds, knownProgrammeIds, knownProjectIds });
    if (rows.length === 0 && errors.length === 0) {
      setParseError("No rows found in that file.");
      return;
    }
    const diffs = rows
      .filter((r) => (r.scopeType === "programme" ? canProgramme : canProject))
      .map((r) => diffGatingRow(r, (r.scopeType === "programme" ? maps?.programmeFeatures : maps?.projectFeatures)?.[r.scopeId]));
    setPreview({ diffs, errors, warnings });
  }

  async function apply() {
    if (!preview) return;
    setApplying(true);
    const toApply = preview.diffs.filter((d) => d.status !== "unchanged");
    let applied = 0;
    const failed: { line: number; scopeId: string; message: string }[] = [];
    // Sequential, not parallel: the per-scope PUT does a read-modify-write over the settings map
    // (`{ ...getSettings().programmeFeatures, [id]: cfg }`), so concurrent writes could race and
    // silently drop one another's change. One row at a time keeps every write safe.
    for (const d of toApply) {
      const row = d.row;
      const config = { disabled: row.disabled, required: row.required, forbidden: row.forbidden };
      try {
        if (row.scopeType === "programme") {
          await setProg.mutateAsync({ programmeId: row.scopeId, config });
        } else {
          const programmeId = projects?.find((p) => p.id === row.scopeId)?.programmeId ?? null;
          await setProj.mutateAsync({ projectId: row.scopeId, programmeId, config });
        }
        applied += 1;
      } catch (e) {
        failed.push({ line: row.line, scopeId: row.scopeId, message: e instanceof Error ? e.message : "Failed." });
      }
    }
    setApplying(false);
    setResult({ applied, skipped: preview.diffs.length - toApply.length, failed });
    setPreview(null);
  }

  const changedDiffs = preview?.diffs.filter((d) => d.status !== "unchanged") ?? [];

  return (
    <section className="space-y-3 border border-border p-3" data-testid="feature-gating-bulk">
      <div>
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Bulk import / export</h3>
        <p className="text-xs text-muted-foreground">
          Export the current programme/project gating as a CSV, edit it in a spreadsheet, then re-import — a faster
          path than editing one scope at a time when the same policy applies to many projects.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs"
          onClick={doExport} data-testid="bulk-gating-export">
          Export CSV
        </Button>
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs"
          onClick={() => fileRef.current?.click()} data-testid="bulk-gating-import-button">
          Import CSV…
        </Button>
        <input ref={fileRef} type="file" accept="text/csv,.csv" className="sr-only" aria-label="Import feature-gating CSV"
          data-testid="bulk-gating-import-input"
          onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
        {parseError && <span role="alert" className="text-xs font-bold text-red-500">{parseError}</span>}
      </div>

      {preview && (
        <div className="space-y-2 border-t border-border pt-3" data-testid="bulk-gating-preview">
          <p className="text-xs">
            <strong>{changedDiffs.length}</strong> row(s) will change ·{" "}
            {preview.diffs.length - changedDiffs.length} unchanged (skipped)
            {preview.errors.length > 0 && <> · <span className="text-red-500 font-bold">{preview.errors.length} row(s) rejected</span></>}
            {preview.warnings.length > 0 && <> · <span className="text-amber-600 font-bold">{preview.warnings.length} warning(s)</span></>}
          </p>

          {preview.errors.length > 0 && (
            <ul className="text-xs text-red-500" data-testid="bulk-gating-errors">
              {preview.errors.map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}
            </ul>
          )}
          {preview.warnings.length > 0 && (
            <ul className="text-xs text-amber-600" data-testid="bulk-gating-warnings">
              {preview.warnings.map((w, i) => <li key={i}>Line {w.line}: {w.message}</li>)}
            </ul>
          )}

          {changedDiffs.length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1 pr-2">Scope</th>
                  <th className="py-1 px-2">Status</th>
                  <th className="py-1 px-2">Disabled</th>
                  <th className="py-1 px-2">Required</th>
                  <th className="py-1 px-2">Forbidden</th>
                </tr>
              </thead>
              <tbody>
                {changedDiffs.map((d) => (
                  <tr key={`${d.row.scopeType}-${d.row.scopeId}`} className="border-b border-border/50" data-testid={`bulk-gating-row-${d.row.scopeType}-${d.row.scopeId}`}>
                    <td className="py-1 pr-2 font-mono">{d.row.scopeType}:{d.row.scopeId}{d.row.scopeName ? ` (${d.row.scopeName})` : ""}</td>
                    <td className="py-1 px-2">{d.status}</td>
                    <td className="py-1 px-2"><Delta d={d.disabled} /></td>
                    <td className="py-1 px-2"><Delta d={d.required} /></td>
                    <td className="py-1 px-2"><Delta d={d.forbidden} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex items-center gap-3">
            <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider"
              onClick={apply} disabled={applying || changedDiffs.length === 0} data-testid="bulk-gating-confirm">
              {applying ? "Applying…" : `Apply ${changedDiffs.length} change(s)`}
            </Button>
            <Button variant="ghost" className="rounded-none text-xs" onClick={() => setPreview(null)} data-testid="bulk-gating-cancel">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="border-t border-border pt-3 text-xs" data-testid="bulk-gating-result">
          <p><strong>{result.applied}</strong> applied, {result.skipped} unchanged (skipped){result.failed.length > 0 && <>, <span className="text-red-500 font-bold">{result.failed.length} failed</span></>}.</p>
          {result.failed.length > 0 && (
            <ul className="text-red-500">
              {result.failed.map((f, i) => <li key={i}>Line {f.line} ({f.scopeId}): {f.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Delta({ d }: { d: { added: string[]; removed: string[] } }) {
  if (d.added.length === 0 && d.removed.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      {d.added.map((id) => <span key={`+${id}`} className="text-green-600">+{id} </span>)}
      {d.removed.map((id) => <span key={`-${id}`} className="text-red-500 line-through">{id} </span>)}
    </span>
  );
}
