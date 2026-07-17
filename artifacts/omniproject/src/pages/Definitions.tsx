import { useEffect, useState } from "react";
import { Database, Trash2, Check, AlertTriangle, Save, ShieldCheck, Pencil } from "lucide-react";
import { DataState } from "../components/DataState";
import {
  useDefs, useDef, useValidateDef, useImportDef, useUpdateDef, useDeleteDef,
  DEF_KINDS, type DefKind, type DefStorage, type StoredDefMeta,
} from "../lib/defs";
import { useDefPolicy, writableDefScopes } from "../lib/def-policy";
import { useAuth } from "../lib/auth";
import { safeParseJson } from "../lib/safe-json";
import { useToast } from "@/hooks/use-toast";

/**
 * Definition importer (roadmap X.3) — the single validated way to put any user-defined JSON definition into
 * the scoped ENCRYPTED stores. Paste a def, pick its kind and where it lives (your private area / a project /
 * org-wide), validate it against the real schema, then save. Nothing is hand-dropped into an encrypted
 * folder; everything passes the server sanitiser + per-kind validator first. Behind the default-off
 * `defImporter` module.
 */

const KIND_LABEL: Record<DefKind, string> = {
  primitive: "Primitive", screen: "Screen", form: "Form", report: "Report", dashboard: "Dashboard",
  businessRule: "Business rule", methodology: "Methodology", mapping: "Field mapping", theme: "Theme (colours)", font: "Font", jsonDef: "JSON def",
};
const STORAGE_LABEL: Record<DefStorage, string> = { user: "My private area", project: "Project", programme: "Programme", org: "Org-wide" };

const STORAGE_OPTION_LABEL: Record<DefStorage, string> = { user: "My private area", project: "Project", programme: "Programme", org: "Org-wide" };

function ImportPanel() {
  const validate = useValidateDef();
  const importDef = useImportDef();
  const { toast } = useToast();
  const { data: auth } = useAuth();
  const { data: policy } = useDefPolicy();
  // Only offer the storage targets THIS author can actually write (server stays authoritative). Everyone can
  // reach the importer; the def-policy scopes what each can save where.
  const writable = writableDefScopes(auth?.role, policy?.policy);
  const [kind, setKind] = useState<DefKind>("primitive");
  const [storage, setStorage] = useState<DefStorage>("user");
  const [projectId, setProjectId] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[] | null>(null);
  const [ok, setOk] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Keep the selected target within what this author can write (e.g. a contributor loses the org option).
  useEffect(() => {
    if (writable.length && !writable.includes(storage)) setStorage(writable[0]!);
  }, [writable, storage]);

  const parsePayload = (): unknown | undefined => {
    try { const p = safeParseJson(text); setParseError(null); return p; }
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
      {
        kind, storage, name, payload,
        ...(storage === "project" && projectId ? { projectId } : {}),
        ...(storage === "programme" && programmeId ? { programmeId } : {}),
      },
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
            {(writable.length ? writable : (["user"] as DefStorage[])).map((s) => (
              <option key={s} value={s}>{STORAGE_OPTION_LABEL[s]}</option>
            ))}
          </select>
        </label>
        {storage === "project" && (
          <label className="text-xs space-y-1">
            <span className="block font-bold uppercase tracking-widest text-muted-foreground">Project id</span>
            <input data-testid="def-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="border border-border bg-background px-2 py-1.5 text-sm" />
          </label>
        )}
        {storage === "programme" && (
          <label className="text-xs space-y-1">
            <span className="block font-bold uppercase tracking-widest text-muted-foreground">Programme id</span>
            <input data-testid="def-programme" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)} className="border border-border bg-background px-2 py-1.5 text-sm" />
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

function EditPanel({ id, onDone }: { id: string; onDone: () => void }) {
  const { data: def, isLoading, isError, error, refetch } = useDef(id);
  const validate = useValidateDef();
  const update = useUpdateDef();
  const { toast } = useToast();
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Seed the editor from the loaded def once.
  const body = text ?? (def ? JSON.stringify(def.payload, null, 2) : "");
  const displayName = name ?? def?.name ?? "";

  const parsePayload = (): unknown | undefined => {
    try { const p = safeParseJson(body); setParseError(null); return p; } catch { setParseError("That isn't valid JSON."); return undefined; }
  };
  const runValidate = () => {
    if (!def) return;
    const payload = parsePayload();
    if (payload === undefined) return;
    validate.mutate({ kind: def.kind, payload }, { onSuccess: (r) => setErrors(r.valid ? [] : r.errors) });
  };
  const save = () => {
    const payload = parsePayload();
    if (payload === undefined) return;
    update.mutate({ id, name: displayName, payload }, {
      onSuccess: () => { toast({ title: "SAVED", description: displayName }); onDone(); },
      onError: () => setErrors(["The edit was rejected — validate it and check your permissions for this scope."]),
    });
  };

  return (
    <div className="bg-card border border-primary/40 p-4 space-y-2" data-testid={`def-edit-${id}`}>
      <div className="flex items-center gap-2"><Pencil className="w-4 h-4" /><h2 className="text-sm font-black uppercase tracking-widest">Edit {def ? KIND_LABEL[def.kind] : "definition"}</h2></div>
      <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-24">
        <label className="text-xs space-y-1 block">
          <span className="block font-bold uppercase tracking-widest text-muted-foreground">Name</span>
          <input data-testid="def-edit-name" value={displayName} onChange={(e) => setName(e.target.value)} className="w-full border border-border bg-background px-2 py-1.5 text-sm" />
        </label>
        <textarea data-testid="def-edit-payload" value={body} onChange={(e) => { setText(e.target.value); setErrors(null); }} rows={12} className="w-full border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
        {parseError && <p className="text-xs text-red-600" data-testid="def-edit-parse-error">{parseError}</p>}
        {errors && errors.length > 0 && (
          <div className="text-xs text-red-600" data-testid="def-edit-errors"><div className="flex items-center gap-1 font-semibold"><AlertTriangle className="w-3.5 h-3.5" />Not valid:</div><ul className="list-disc list-inside">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
        )}
        {errors && errors.length === 0 && <p className="text-xs text-green-700 font-semibold flex items-center gap-1"><Check className="w-3.5 h-3.5" />Valid.</p>}
        <div className="flex gap-2">
          <button type="button" onClick={runValidate} disabled={validate.isPending} data-testid="def-edit-validate" className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-40"><ShieldCheck className="w-3.5 h-3.5" />Validate</button>
          <button type="button" onClick={save} disabled={update.isPending} data-testid="def-edit-save" className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40"><Save className="w-3.5 h-3.5" />Save changes</button>
          <button type="button" onClick={onDone} className="border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40">Cancel</button>
        </div>
      </DataState>
    </div>
  );
}

function DefRow({ meta, onEdit }: { meta: StoredDefMeta; onEdit: (id: string) => void }) {
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
      <div className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={() => onEdit(meta.id)} data-testid={`def-edit-btn-${meta.id}`} aria-label="Edit" className="text-muted-foreground hover:text-primary"><Pencil className="w-4 h-4" /></button>
        <button type="button" onClick={() => del.mutate(meta.id)} data-testid={`def-delete-${meta.id}`} aria-label="Delete" className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export function Definitions() {
  const { data: defs, isLoading, isError, error, refetch } = useDefs();
  const [editingId, setEditingId] = useState<string | null>(null);
  const list = defs ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-black uppercase tracking-widest flex items-center gap-2"><Database className="w-5 h-5" />Definitions</h1>
        <p className="text-xs text-muted-foreground">Import any user-defined JSON definition into an encrypted store — your private area, a project, or org-wide. Everything is validated by its kind before it's sealed. No code, ever.</p>
      </div>

      {editingId ? <EditPanel id={editingId} onDone={() => setEditingId(null)} /> : <ImportPanel />}

      <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-32">
        <div className="space-y-2" data-testid="def-list">
          {list.length === 0 && <p className="text-sm text-muted-foreground">No stored definitions yet. Paste one above and save it.</p>}
          {list.map((m) => <DefRow key={m.id} meta={m} onEdit={setEditingId} />)}
        </div>
      </DataState>
    </div>
  );
}
