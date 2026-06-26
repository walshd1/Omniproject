import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCapabilities,
  useGetSettings,
  useUpdateSettings,
  useGetFieldManifest,
  getGetCapabilitiesQueryKey,
  getGetSettingsQueryKey,
  getGetFieldManifestQueryKey,
} from "@workspace/api-client-react";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Support = { surface: boolean; store: boolean };
type Overrides = Record<string, Support>;

const eff = (map: Record<string, Support> | undefined, key: string): Support =>
  map?.[key] ?? { surface: true, store: true };

function Row({
  k,
  effective,
  override,
  onToggle,
  onSet,
}: {
  k: string;
  effective: Support;
  override: Support | undefined;
  onToggle: () => void;
  onSet: (s: Support) => void;
}) {
  const overridden = !!override;
  const view = override ?? effective;
  return (
    <div className="flex items-center gap-3 border-b border-border py-1.5 text-xs">
      <span className="font-mono flex-1 truncate" title={k}>{k}</span>
      <span className={`w-16 text-center ${overridden ? "text-foreground font-bold" : "text-muted-foreground"}`}>
        {view.surface ? "surface" : "—"}
      </span>
      <span className={`w-14 text-center ${overridden ? "text-foreground font-bold" : "text-muted-foreground"}`}>
        {view.store ? "store" : "—"}
      </span>
      {overridden ? (
        <span className="flex items-center gap-2 w-40 justify-end">
          <label className="flex items-center gap-1"><input type="checkbox" aria-label={`${k} surface`} checked={view.surface} onChange={(e) => onSet({ ...view, surface: e.target.checked })} className="accent-primary" /> surf</label>
          <label className="flex items-center gap-1"><input type="checkbox" aria-label={`${k} store`} checked={view.store} onChange={(e) => onSet({ ...view, store: e.target.checked })} className="accent-primary" /> store</label>
          <button type="button" onClick={onToggle} className="text-muted-foreground hover:text-red-500 font-bold px-1" aria-label={`Clear override for ${k}`}>✕</button>
        </span>
      ) : (
        <span className="w-40 text-right">
          <button type="button" onClick={onToggle} aria-label={`Override ${k}`} className="text-[11px] uppercase font-bold tracking-wider text-muted-foreground hover:text-primary border border-border px-1.5 py-0.5">Override</button>
        </span>
      )}
    </div>
  );
}

/**
 * Admin-only translation-layer editor — correct the per-field/entity capability
 * map when the auto-derivation or a backend mis-maps something. Overrides REPLACE
 * the effective surface/store and persist in gateway settings (config, not
 * project data). Hidden for non-admins; the gateway also enforces the admin gate.
 */
export function TranslationLayer() {
  const { data: auth } = useAuth();
  const { data: caps } = useGetCapabilities();
  const { data: settings } = useGetSettings();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isAdmin = roleAtLeast(auth?.role, "admin");
  // The describe → reconcile manifest (manager+); only fetched for admins here.
  const { data: manifest } = useGetFieldManifest({
    query: { enabled: isAdmin, queryKey: getGetFieldManifestQueryKey() },
  });

  const [fields, setFields] = useState<Overrides>({});
  const [entities, setEntities] = useState<Overrides>({});
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const ov = (settings as { fieldOverrides?: { fields?: Overrides; entities?: Overrides } } | undefined)?.fieldOverrides;
    setFields(ov?.fields ?? {});
    setEntities(ov?.entities ?? {});
  }, [settings]);

  const fieldKeys = useMemo(
    () => Object.keys({ ...(caps?.fields ?? {}), ...fields }).sort().filter((k) => k.toLowerCase().includes(filter.toLowerCase())),
    [caps, fields, filter],
  );
  const entityKeys = useMemo(
    () => Object.keys({ ...(caps?.entities ?? {}), ...entities }).sort(),
    [caps, entities],
  );

  if (!isAdmin) return null;

  const overrideCount = Object.keys(fields).length + Object.keys(entities).length;

  const toggle = (set: (fn: (o: Overrides) => Overrides) => void, map: Record<string, Support> | undefined, key: string) =>
    set((o) => {
      if (o[key]) { const { [key]: _drop, ...rest } = o; return rest; }
      return { ...o, [key]: { ...eff(map, key) } };
    });

  const save = () => {
    update.mutate(
      { data: { fieldOverrides: { fields, entities } } as never },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetCapabilitiesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          toast({ title: "TRANSLATION LAYER SAVED", description: `${overrideCount} override${overrideCount === 1 ? "" : "s"} active` });
        },
        onError: (err) => toast({
          title: (err as { status?: number }).status === 403 ? "ADMIN ONLY" : "ERROR",
          description: "Couldn't save the translation layer.",
          variant: "destructive",
        }),
      },
    );
  };

  return (
    <section data-testid="translation-layer" className="border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest">
            Translation layer
            <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-widest text-amber-500 border border-amber-500/40 px-1.5 py-0.5">admin</span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Correct the capability map — force a field/entity on or off when the backend mapping is wrong. Overrides replace the derived value.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{overrideCount} override{overrideCount === 1 ? "" : "s"}</span>
          <Button type="button" variant="outline" disabled={overrideCount === 0} onClick={() => { setFields({}); setEntities({}); }}
            className="rounded-none border-border uppercase font-bold tracking-wider text-xs h-9">Clear all</Button>
          <Button type="button" onClick={save} disabled={update.isPending}
            className="rounded-none uppercase font-bold tracking-wider text-xs h-9">{update.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">Entities</h3>
          {entityKeys.map((k) => (
            <Row key={k} k={k} effective={eff(caps?.entities, k)} override={entities[k]}
              onToggle={() => toggle(setEntities, caps?.entities, k)}
              onSet={(s) => setEntities((o) => ({ ...o, [k]: s }))} />
          ))}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Fields</h3>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter fields…" aria-label="Filter fields"
              className="h-8 w-44 rounded-none border-border font-mono text-xs" />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {fieldKeys.map((k) => (
              <Row key={k} k={k} effective={eff(caps?.fields, k)} override={fields[k]}
                onToggle={() => toggle(setFields, caps?.fields, k)}
                onSet={(s) => setFields((o) => ({ ...o, [k]: s }))} />
            ))}
          </div>
        </div>

        {/* The describe → reconcile manifest: what the backend exposes vs the
            canonical registry, and the custom fields discovered + auto-surfaced. */}
        {manifest && (
          <div data-testid="field-manifest" className="border-t border-border pt-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">
              Backend field manifest <span className="text-[10px] font-mono opacity-60">· {manifest.mode}</span>
            </h3>
            <div className="flex flex-wrap gap-3 text-xs mb-3">
              <span className="border border-border px-2 py-1"><span className="font-black text-primary">{manifest.reconciliation.known.length}</span> mapped</span>
              <span className="border border-border px-2 py-1"><span className="font-black text-amber-500">{manifest.reconciliation.unknown.length}</span> custom (unmapped)</span>
              <span className="border border-border px-2 py-1"><span className="font-black text-muted-foreground">{manifest.reconciliation.missing.length}</span> not exposed</span>
            </div>
            {manifest.customFields.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Custom fields discovered — carried through as gated passthrough
                </p>
                <ul className="text-xs font-mono">
                  {manifest.customFields.map((f) => (
                    <li key={f.key} className="flex items-center gap-2 border-b border-border py-1">
                      <span className="text-amber-500">●</span>
                      <span className="font-bold">{f.key}</span>
                      <span className="text-muted-foreground truncate">{f.label}</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1">{f.type}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
