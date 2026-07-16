import { useState } from "react";
import { Database, Trash2, Check, AlertTriangle, Save, ShieldCheck } from "lucide-react";
import { DataState } from "../components/DataState";
import {
  useDefs, useValidateDef, useImportDef, useDeleteDef,
  DEF_KINDS, type DefKind, type DefStorage, type StoredDefMeta,
} from "../lib/defs";
import { useToast } from "@/hooks/use-toast";

/**
 * Definition importer (roadmap X.3) — the single validated way to put any user-defined JSON definition into
 * the scoped ENCRYPTED stores. Paste a def, pick its kind and where it lives (your private area / a project /
 * org-wide), validate it against the real schema, then save. Nothing is hand-dropped into an encrypted
 * folder; everything passes the server sanitiser + per-kind validator first. Behind the default-off
 * `defImporter` module.
 */

const KIND_LABEL: Record<DefKind, string> = {
  primitive: "Primitive", screen: "Screen", form: "Form", report: "Report", dashboard: "Dashboard", jsonDef: "JSON def",
};
const STORAGE_LABEL: Record<DefStorage, string> = { user: "My private area", project: "Project", org: "Org-wide" };

function ImportPanel() {
  const validate = useValidateDef();
  const importDef = useImportDef();
  const { toast } = useToast();
  const [kind, setKind] = useState<DefKind>("primitive");
  const [storage, setStorage] = useState<DefStorage>("user");
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[] | null>(null);
  const [ok, setOk] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const parsePayload = (): unknown | undefined => {
    try { const p = JSON.parse(text); setParseError(null); return p; }
    catch { setParseError("That isn't valid JSON."); return undefined; }
  };

  const runValidate = () => {
    const payload = parsePayload();
    if (payload === undefined) return;
    validate.mutate({ kind, payload }, {
      onSuccess: (r) => { setOk(r.valid); setErrors(r.valid ? [] : r.errors); },
    });
  };

  const save = () => {
    const payload = parsePayload();
    if (payload === undefined) return;
    importDef.mutate(
      { kind, storage, ...(storage === "project" && projectId ? { projectId } : {}), name, payload },
      {
        onSuccess: (d) => { toast({ title: "SAVED", description: `${d.name} → ${STORAGE_LABEL[storage]}` }); setText(""); setName(""); setOk(false); setErrors(null); },
        onError: () => setErrors(["The import was rejected — validate it, check the storage target, and your permissions."]),
      },
    );
  };

  return (
    <div className="bg-card border border-border p-4 space-y-3" data-testid="def-import-panel">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs space-y-1">
          <span className="block font-bold uppercase tracking-widest text-muted-foreground">Kind</span>
          <select data-testid="def-kind" value={kind} onChange={(e) => { setKind(e.target.value as DefKind); setOk(false); setErrors(null); }} className="border border-border bg-background px-2 py-1.5 text-sm">
            {DEF_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span className="block font-bold uppercase tracking-widest text-muted-foreground">Store in</span>
          <select data-testid="def-storage" value={storage} onChange={(e) => setStorage(e.target.value as DefStorage)} className="border border-border bg-background px-2 py-1.5 text-sm">
            <option value="user">My private area</option>
            <option value="project">Project</option>
            <option value="org">Org-wide</option>
          </select>
        </label>
        {storage === "project" && (
          <label className="text-xs space-y-1">
            <span className="block font-bold uppercase tracking-widest text-muted-foreground">Project id</span>
            <input data-testid="def-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="border border-border bg-background px-2 py-1.5 text-sm" />
          </label>
        )}
        <label className="text-xs space-y-1 flex-1 min-w-40">
          <span className="block font-bold uppercase tracking-widest text-muted-foreground">Name</span>
          <input data-testid="def-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="A human name" className="w-full border border-border bg-background px-2 py-1.5 text-sm" />
        </label>
      </div>

      <textarea
        data-testid="def-payload"
        value={text}
        onChange={(e) => { setText(e.target.value); setOk(false); setErrors(null); }}
        rows={10}
        placeholder={'{\n  "id": "grouped-column",\n  "label": "Grouped columns",\n  "category": "chart",\n  "params": []\n}'}
        className="w-full border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {parseError && <p className="text-xs text-red-600" data-testid="def-parse-error">{parseError}</p>}
      {errors && errors.length > 0 && (
        <div className="text-xs text-red-600 space-y-0.5" data-testid="def-errors">
          <div className="flex items-center gap-1 font-semibold"><AlertTriangle className="w-3.5 h-3.5" />Not valid:</div>
          <ul className="list-disc list-inside">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {ok && <p className="text-xs text-green-700 font-semibold flex items-center gap-1" data-testid="def-valid"><Check className="w-3.5 h-3.5" />Valid — ready to save.</p>}

      <div className="flex gap-2">
        <button type="button" onClick={runValidate} disabled={!text.trim() || validate.isPending} data-testid="def-validate" className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-40"><ShieldCheck className="w-3.5 h-3.5" />Validate</button>
        <button type="button" onClick={save} disabled={!text.trim() || !name.trim() || importDef.isPending} data-testid="def-save" className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40"><Save className="w-3.5 h-3.5" />Save to store</button>
      </div>
    </div>
  );
}

function DefRow({ meta }: { meta: StoredDefMeta }) {
  const del = useDeleteDef();
  return (
    <div data-testid={`def-row-${meta.id}`} className="border border-border p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold truncate">{meta.name}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{KIND_LABEL[meta.kind]}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 text-muted-foreground">{meta.storage}</span>
        </div>
      </div>
      <button type="button" onClick={() => del.mutate(meta.id)} data-testid={`def-delete-${meta.id}`} aria-label="Delete" className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

export function Definitions() {
  const { data: defs, isLoading, isError, error, refetch } = useDefs();
  const list = defs ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-black uppercase tracking-widest flex items-center gap-2"><Database className="w-5 h-5" />Definitions</h1>
        <p className="text-xs text-muted-foreground">Import any user-defined JSON definition into an encrypted store — your private area, a project, or org-wide. Everything is validated by its kind before it's sealed. No code, ever.</p>
      </div>

      <ImportPanel />

      <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-32">
        <div className="space-y-2" data-testid="def-list">
          {list.length === 0 && <p className="text-sm text-muted-foreground">No stored definitions yet. Paste one above and save it.</p>}
          {list.map((m) => <DefRow key={m.id} meta={m} />)}
        </div>
      </DataState>
    </div>
  );
}
