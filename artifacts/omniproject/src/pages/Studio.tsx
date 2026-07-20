import { useState } from "react";
import { Sparkles, Check, AlertTriangle, Send, RefreshCw, Wand2, ImagePlus, X } from "lucide-react";
import { ChartView, type ChartViewSpec } from "../components/charts/ChartView";
import { useStudioStatus, useGeneratePrimitive, type PrimitiveStudioResult, type StudioImage } from "../lib/studio";
import { useImportDef, type DefStorage } from "../lib/defs";
import type { PrimitiveDefShape } from "@workspace/backend-catalogue";
import { useToast } from "@/hooks/use-toast";

/**
 * Primitive Studio (roadmap X.2) — the AI authoring companion. Describe a chart/graphic; the skill generates
 * a candidate primitive bundle and validates it; we render it back with the test results; refine on feedback
 * and regenerate; when it's valid and you're happy, SAVE it through the definition importer (X.3) into the
 * scoped encrypted store you pick (your private area or org-wide). The
 * model only proposes a declarative descriptor — never code. Behind the default-off `studio` module.
 */

/** A small sample ChartViewSpec so the user can SEE the shape a chart primitive draws, or null when we can't
 *  preview that type (validation still tells them it's sound). */
function demoSpec(def: PrimitiveDefShape | undefined): ChartViewSpec | null {
  if (!def?.chartType) return null;
  const rows = [
    { name: "Alpha", "Series 1": 12, "Series 2": 8 },
    { name: "Beta", "Series 1": 19, "Series 2": 14 },
    { name: "Gamma", "Series 1": 7, "Series 2": 11 },
  ];
  const series = [{ key: "Series 1", label: "Series 1" }, { key: "Series 2", label: "Series 2" }];
  switch (def.chartType) {
    case "bar": return { type: "bar", data: rows, series };
    case "line": return { type: "line", data: rows, series };
    case "area": return { type: "area", data: rows, series };
    case "pie":
    case "donut": return { type: def.chartType, data: [{ name: "Alpha", value: 40 }, { name: "Beta", value: 35 }, { name: "Gamma", value: 25 }] };
    default: return null; // scatter/treemap/gantt need bespoke data — skip the preview, keep the verdict
  }
}

function Verdict({ result }: { result: PrimitiveStudioResult }) {
  if (result.valid) {
    return (
      <div className="flex items-center gap-2 text-green-700 text-sm font-semibold" data-testid="studio-valid">
        <Check className="w-4 h-4" /> Valid primitive — ready to submit.
      </div>
    );
  }
  return (
    <div className="space-y-1" data-testid="studio-errors">
      <div className="flex items-center gap-2 text-red-700 text-sm font-semibold"><AlertTriangle className="w-4 h-4" /> Not valid yet — refine and regenerate:</div>
      <ul className="list-disc list-inside text-xs text-red-600">
        {result.errors.map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    </div>
  );
}

function Preview({ result }: { result: PrimitiveStudioResult }) {
  const spec = demoSpec(result.def);
  return (
    <div className="border border-border p-3 space-y-2" data-testid="studio-preview">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Preview {spec ? "(sample data)" : ""}</div>
      {spec ? (
        <div className="h-56"><ChartView {...spec} /></div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {result.def ? `A ${result.def.category} primitive with ${result.def.params.length} input${result.def.params.length === 1 ? "" : "s"}: ${result.def.params.map((p) => p.label).join(", ")}.` : "No renderable preview — fix the validation errors first."}
        </p>
      )}
    </div>
  );
}

export function Studio() {
  const { data: status } = useStudioStatus();
  const generate = useGeneratePrimitive();
  const importDef = useImportDef();
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState("");
  const [image, setImage] = useState<StudioImage | null>(null);
  const [storage, setStorage] = useState<DefStorage>("user");
  const [result, setResult] = useState<PrimitiveStudioResult | null>(null);

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result); // data:<mime>;base64,<data>
      const comma = url.indexOf(",");
      const mimeMatch = /^data:([^;]+);base64$/.exec(url.slice(0, comma));
      if (comma > 0 && mimeMatch) setImage({ mime: mimeMatch[1]!, dataBase64: url.slice(comma + 1) });
    };
    reader.readAsDataURL(file);
  };

  const run = (iterate: boolean) => {
    const input = {
      description,
      ...(iterate && result ? { feedback, previous: result.submission.payload } : {}),
      ...(image ? { image } : {}),
    };
    generate.mutate(input, {
      onSuccess: (r) => { setResult(r); setFeedback(""); },
      onError: () => toast({ title: "GENERATION FAILED", description: "The AI couldn't produce a primitive — try rewording your description." }),
    });
  };

  const STORAGE_LABEL: Record<DefStorage, string> = { user: "my private area", project: "a project", programme: "a programme", org: "org-wide" };
  const save = () => {
    if (!result) return;
    importDef.mutate(
      { kind: "primitive", storage, name: result.submission.name, payload: result.submission.payload },
      {
        onSuccess: (d) => toast({ title: "SAVED", description: `${d.name} → ${STORAGE_LABEL[storage]} (encrypted store).` }),
        onError: () => toast({ title: "SAVE FAILED", description: "Is the importer enabled? Org-wide needs manager+; check your access." }),
      },
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-black uppercase tracking-widest flex items-center gap-2"><Wand2 className="w-5 h-5" />Primitive studio</h1>
        <p className="text-xs text-muted-foreground">Describe a chart or graphic; the AI drafts a primitive, tests it, and you refine it until it's right — then submit it to the registry. The model writes a declarative descriptor, never code.</p>
      </div>

      {status && !status.available && (
        <p className="text-xs text-amber-600" data-testid="studio-unavailable">No AI provider is configured, or AI authoring is turned off. An admin enables it in Settings.</p>
      )}

      <div className="bg-card border border-border p-4 space-y-2">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground" htmlFor="studio-desc">Describe your primitive</label>
        <textarea
          id="studio-desc"
          data-testid="studio-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="e.g. A grouped column chart comparing planned vs actual spend across a handful of categories"
          className="w-full border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => run(false)} disabled={!description.trim() || generate.isPending} data-testid="studio-generate" className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40">
            <Sparkles className="w-3.5 h-3.5" />{generate.isPending ? "Generating…" : "Generate"}
          </button>
          <label className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40 cursor-pointer" data-testid="studio-image-pick">
            <ImagePlus className="w-3.5 h-3.5" />{image ? "Change image" : "Add image"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" data-testid="studio-image-input" onChange={(e) => onPickImage(e.target.files?.[0])} />
          </label>
          {image && (
            <span className="inline-flex items-center gap-1.5" data-testid="studio-image-chip">
              <img src={`data:${image.mime};base64,${image.dataBase64}`} alt="reference" className="h-8 w-8 object-cover border border-border" />
              <button type="button" onClick={() => setImage(null)} aria-label="Remove image" data-testid="studio-image-remove" className="text-muted-foreground hover:text-red-600"><X className="w-4 h-4" /></button>
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">Optional: attach a sketch or screenshot and the AI will match it (needs a vision-capable provider).</p>
      </div>

      {result && (
        <div className="space-y-3" data-testid="studio-result">
          <Verdict result={result} />
          <Preview result={result} />

          <details className="border border-border p-3">
            <summary className="text-xs font-bold uppercase tracking-widest text-muted-foreground cursor-pointer">Bundle JSON</summary>
            <pre data-testid="studio-json" className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-all">{JSON.stringify(result.submission, null, 2)}</pre>
          </details>

          <div className="bg-card border border-border p-4 space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground" htmlFor="studio-feedback">Refine</label>
            <input
              id="studio-feedback"
              data-testid="studio-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. make the bars horizontal and add a legend"
              className="w-full border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2 items-center flex-wrap">
              <button type="button" onClick={() => run(true)} disabled={!feedback.trim() || generate.isPending} data-testid="studio-refine" className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-40"><RefreshCw className="w-3.5 h-3.5" />Refine</button>
              <span className="flex-1" />
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Save to</label>
              <select data-testid="studio-storage" value={storage} onChange={(e) => setStorage(e.target.value as DefStorage)} className="border border-border bg-background px-2 py-1.5 text-xs">
                <option value="user">My private area</option>
                <option value="org">Org-wide</option>
              </select>
              <button type="button" onClick={save} disabled={!result.valid || importDef.isPending} data-testid="studio-submit" className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40"><Send className="w-3.5 h-3.5" />Save to store</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
