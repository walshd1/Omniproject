import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SCREEN_COMPONENT_IDS } from "../screen/screen-components";
import { safeParseJson } from "../../lib/safe-json";
import type { OrgScreenDef } from "../../lib/org-screens";

/**
 * ScreenEditor — the visual builder a PMO uses to author or customise a screen without hand-writing JSON.
 * It edits the screen's shell (label, route, methodology tags, full-bleed) and its list of panels — each a
 * generic primitive whose instance config the form drives (a `table`/`chart` gets a data-source URL; a
 * `chart` also a type/x/series; a `view` picks a board; a `component` picks a page; a `text` gets prose).
 * It emits the same JSON screen def the store persists, so "build from scratch" and "modify a default" are
 * one flow. A raw-JSON escape hatch stays for power users / fields the form doesn't surface.
 */
const PANEL_KINDS = ["table", "chart", "view", "component", "metric", "text", "list", "graph", "map"] as const;
const VIEW_IDS = ["kanban", "scrum", "gantt", "prince2", "raid", "list", "flow"] as const;
const CHART_TYPES = ["bar", "line", "area", "pie"] as const;

type Panel = Record<string, unknown> & { id: string; kind: string };
// The editor works on a LOOSE screen shape (panel kinds are free strings so a config-folder-added kind is
// editable); it's cast back to the store's OrgScreenDef at the save boundary.
type LooseDef = Record<string, unknown> & { id: string; label?: string; panels: Panel[] };

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const cfg = (p: Panel): Record<string, unknown> => (p.config && typeof p.config === "object" ? (p.config as Record<string, unknown>) : {});
const src = (p: Panel): Record<string, unknown> => (p.source && typeof p.source === "object" ? (p.source as Record<string, unknown>) : {});

export function ScreenEditor({ def, onSave, onCancel, saving, allowRoute }: {
  def: OrgScreenDef;
  onSave: (d: OrgScreenDef) => void;
  onCancel: () => void;
  saving?: boolean;
  /** Core screens keep their built-in route; only non-core screens expose the route field. */
  allowRoute?: boolean;
}) {
  const [d, setD] = useState<LooseDef>(() => structuredClone(def) as unknown as LooseDef);
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const panels = (Array.isArray(d.panels) ? d.panels : []) as Panel[];
  const setPanels = (next: Panel[]) => setD({ ...d, panels: next });
  const setPanel = (i: number, patch: Partial<Panel>) => setPanels(panels.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setPanelCfg = (i: number, patch: Record<string, unknown>) => setPanel(i, { config: { ...cfg(panels[i]!), ...patch } });
  const setPanelSrc = (i: number, url: string) => setPanel(i, url ? { source: { ...src(panels[i]!), url } } : { source: undefined });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= panels.length) return;
    const next = [...panels];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setPanels(next);
  };
  const addPanel = () => setPanels([...panels, { id: `panel-${panels.length + 1}`, kind: "table" }]);

  const badPanels = new Set<number>();
  const seen = new Set<string>();
  panels.forEach((p, i) => { if (!asStr(p.id).trim() || !asStr(p.kind).trim() || seen.has(p.id)) badPanels.add(i); if (p.id) seen.add(p.id); });
  const invalid = !asStr(d.label).trim() || badPanels.size > 0;

  const commit = () => onSave(d as unknown as OrgScreenDef);

  const applyRaw = () => {
    try {
      const parsed = safeParseJson<LooseDef>(rawText);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.panels)) throw new Error("must be an object with a panels array");
      setD({ ...parsed, id: d.id });
      setRaw(false);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Invalid JSON"); }
  };

  if (raw) {
    return (
      <div className="space-y-2" data-testid="screen-editor-raw">
        <Textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={14} className="font-mono text-xs" aria-label="Raw screen JSON" data-testid="screen-editor-json" />
        {error && <p className="text-xs text-destructive" data-testid="screen-editor-error">{error}</p>}
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={applyRaw} data-testid="screen-editor-apply-json">Apply JSON</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRaw(false)}>Back to form</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="screen-editor">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-bold">Label
          <Input value={asStr(d.label)} onChange={(e) => setD({ ...d, label: e.target.value })} className="h-8 ml-2 inline-block max-w-52" data-testid="screen-editor-label" />
        </label>
        {allowRoute && (
          <label className="text-xs font-bold">Route
            <Input value={asStr(d.route)} onChange={(e) => setD({ ...d, route: e.target.value })} placeholder="/my-screen" className="h-8 ml-2 inline-block max-w-40 font-mono" data-testid="screen-editor-route" />
          </label>
        )}
        <label className="flex items-center gap-1 text-xs font-bold">
          <input type="checkbox" checked={d.bare === true} onChange={(e) => setD({ ...d, bare: e.target.checked })} data-testid="screen-editor-bare" /> Full-bleed
        </label>
        <label className="text-xs font-bold">Methodologies
          <Input
            value={Array.isArray(d.methodologies) ? (d.methodologies as string[]).join(", ") : ""}
            onChange={(e) => setD({ ...d, methodologies: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="kanban, scrum" className="h-8 ml-2 inline-block max-w-40" data-testid="screen-editor-methodologies" />
        </label>
      </div>

      <div className="space-y-2">
        {panels.map((p, i) => {
          const kind = asStr(p.kind);
          return (
            <div key={i} className={`border p-2 space-y-2 ${badPanels.has(i) ? "border-red-500/50" : "border-border"}`} data-testid={`panel-editor-${i}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={asStr(p.id)} onChange={(e) => setPanel(i, { id: e.target.value })} placeholder="panel id" className="h-8 max-w-32 font-mono" aria-label={`Panel ${i + 1} id`} data-testid={`panel-id-${i}`} />
                <select value={kind} onChange={(e) => setPanel(i, { kind: e.target.value })} className="h-8 border-2 border-foreground bg-background px-1 text-xs font-bold" aria-label={`Panel ${i + 1} kind`} data-testid={`panel-kind-${i}`}>
                  {PANEL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <Input value={asStr(p.title)} onChange={(e) => setPanel(i, { title: e.target.value })} placeholder="title" className="h-8 max-w-40" aria-label={`Panel ${i + 1} title`} />
                <Input type="number" value={typeof p.span === "number" ? p.span : ""} onChange={(e) => setPanel(i, { span: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="span" className="h-8 max-w-16 tabular-nums" aria-label={`Panel ${i + 1} span`} />
                <div className="ml-auto flex items-center gap-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => move(i, -1)} aria-label={`Move panel ${i + 1} up`}>↑</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => move(i, 1)} aria-label={`Move panel ${i + 1} down`}>↓</Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setPanels(panels.filter((_, j) => j !== i))} data-testid={`panel-remove-${i}`}>✕</Button>
                </div>
              </div>

              {(kind === "table" || kind === "chart") && (
                <Input value={asStr(src(p).url)} onChange={(e) => setPanelSrc(i, e.target.value)} placeholder="data source URL (e.g. /api/budget-plans/rows?groupBy=year&metric=sum:amount)" className="h-8 font-mono text-xs" aria-label={`Panel ${i + 1} source`} data-testid={`panel-source-${i}`} />
              )}
              {kind === "chart" && (
                <div className="flex flex-wrap items-center gap-2">
                  <select value={asStr(cfg(p).chartType) || "bar"} onChange={(e) => setPanelCfg(i, { chartType: e.target.value })} className="h-8 border border-foreground bg-background px-1 text-xs" aria-label={`Panel ${i + 1} chart type`}>
                    {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Input value={asStr(cfg(p).xKey)} onChange={(e) => setPanelCfg(i, { xKey: e.target.value })} placeholder="x field" className="h-8 max-w-28" aria-label={`Panel ${i + 1} x`} />
                  <Input
                    value={Array.isArray(cfg(p).series) ? (cfg(p).series as { key: string }[]).map((x) => x.key).join(", ") : ""}
                    onChange={(e) => setPanelCfg(i, { series: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).map((key) => ({ key, label: key })) })}
                    placeholder="value fields (comma)" className="h-8 max-w-40" aria-label={`Panel ${i + 1} series`} />
                </div>
              )}
              {kind === "view" && (
                <select value={asStr(cfg(p).view)} onChange={(e) => setPanelCfg(i, { view: e.target.value })} className="h-8 border border-foreground bg-background px-1 text-xs" aria-label={`Panel ${i + 1} view`} data-testid={`panel-view-${i}`}>
                  <option value="">— pick a view —</option>
                  {VIEW_IDS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              {kind === "component" && (
                <select value={asStr(cfg(p).component)} onChange={(e) => setPanelCfg(i, { component: e.target.value })} className="h-8 border border-foreground bg-background px-1 text-xs" aria-label={`Panel ${i + 1} component`} data-testid={`panel-component-${i}`}>
                  <option value="">— pick a component —</option>
                  {SCREEN_COMPONENT_IDS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {kind === "text" && (
                <Textarea value={asStr(cfg(p).text)} onChange={(e) => setPanelCfg(i, { text: e.target.value })} rows={3} placeholder="prose / guidance" className="text-xs" aria-label={`Panel ${i + 1} text`} />
              )}
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={addPanel} data-testid="screen-editor-add-panel">Add panel</Button>
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <Button type="button" size="sm" onClick={commit} disabled={invalid || saving} data-testid="screen-editor-save">{saving ? "Saving…" : "Save screen"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setRawText(JSON.stringify(d, null, 2)); setRaw(true); }} className="ml-auto" data-testid="screen-editor-raw-toggle">Edit raw JSON</Button>
      </div>
    </div>
  );
}
