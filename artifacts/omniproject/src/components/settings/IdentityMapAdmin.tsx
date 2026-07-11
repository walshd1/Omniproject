import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useRateCard, useIdentities, useSaveIdentities, type IdentityAssignment } from "../../lib/rate-card";

/**
 * PMO identity → role map. Each assignee is mapped to a job title so their logged time can be costed.
 * The assignee name is hashed SERVER-SIDE (keyed HMAC) and only the hash is stored — so the map can
 * never be read back to a name. This screen is therefore append/update-oriented: you enter a name +
 * pick a role and save; the per-scope count shows how many are mapped without revealing who. Mappings
 * can be set centrally, or overridden for one programme/project. PMO-gated, mirroring the server.
 */

type Level = "central" | "programme" | "project";

/** One staged assignment row in the editor (assignee plaintext + the chosen role's title hash).
 *  `id` is a client-only stable key so removing a middle row doesn't shift the others' input state;
 *  it never leaves the component (onSave maps rows to plaintext assignments). */
interface Row {
  id: string;
  assignee: string;
  titleHash: string;
}

const emptyRow = (): Row => ({ id: crypto.randomUUID(), assignee: "", titleHash: "" });

export function IdentityMapAdmin() {
  const { data: auth } = useAuth();
  const { data: card } = useRateCard();
  const { data: identities } = useIdentities();
  const saveIdentities = useSaveIdentities();
  const [level, setLevel] = useState<Level>("central");
  const [scopeId, setScopeId] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!card) return null;

  const titles = Object.entries(card.titles); // [hash, label]
  const scopeNeedsId = level !== "central";

  // How many assignments already exist for the chosen scope (count only — names are hashed).
  const existingCount = !identities
    ? 0
    : level === "central"
      ? Object.keys(identities.central ?? {}).length
      : Object.keys((scopeNeedsId && scopeId ? identities[level]?.[scopeId] : undefined) ?? {}).length;

  const canSave = (!scopeNeedsId || !!scopeId) && rows.some((r) => r.assignee.trim()) && titles.length > 0;

  function onSave() {
    const assignments: IdentityAssignment[] = rows
      .filter((r) => r.assignee.trim())
      .map((r) => ({ assignee: r.assignee.trim(), titleHash: r.titleHash }));
    saveIdentities.mutate(
      { level, ...(scopeNeedsId ? { scopeId } : {}), assignments },
      { onSuccess: () => setRows([emptyRow()]) },
    );
  }

  return (
    <section className="space-y-3" data-testid="identity-map-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Rate card — identity → role map</h2>
        <p className="text-xs text-muted-foreground">
          Map each assignee to a job title so their time can be costed. Names are hashed on save and never
          stored in the clear, so this list can't be read back — enter a name again to update or clear it.
        </p>
      </div>

      {titles.length === 0 ? (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="identity-no-roles">
          No job titles yet — add roles in the rate grid above before mapping people to them.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs flex items-center gap-1">
              <span className="text-muted-foreground">Scope</span>
              <select aria-label="Identity map scope level" className="rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs"
                value={level} onChange={(e) => { setLevel(e.target.value as Level); setScopeId(""); }}>
                <option value="central">Central (all)</option>
                <option value="programme">Programme</option>
                <option value="project">Project</option>
              </select>
            </label>
            {scopeNeedsId && (
              <Input aria-label="Scope id" placeholder={`${level} id`} className="w-44 rounded-none border-2 border-foreground font-mono text-xs"
                value={scopeId} onChange={(e) => setScopeId(e.target.value)} />
            )}
            <span className="text-[11px] text-muted-foreground" data-testid="identity-count">
              {scopeNeedsId && !scopeId ? "enter a scope id" : `${existingCount} mapping(s) at this scope`}
            </span>
          </div>

          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2" data-testid={`identity-row-${i}`}>
                <Input aria-label={`Assignee ${i + 1}`} placeholder="Assignee (name / email / id)" className="w-56 rounded-none border border-border"
                  value={r.assignee} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, assignee: e.target.value } : x)))} />
                <label className="text-xs flex items-center gap-1">
                  <span className="sr-only">{`Assignee ${i + 1} role`}</span>
                  <select aria-label={`Assignee ${i + 1} role`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                    value={r.titleHash} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, titleHash: e.target.value } : x)))}>
                    <option value="">— clear mapping —</option>
                    {titles.map(([hash, label]) => <option key={hash} value={hash}>{label}</option>)}
                  </select>
                </label>
                <Button variant="ghost" className="rounded-none text-xs px-2" aria-label={`Remove assignment row ${i + 1}`}
                  onClick={() => setRows(rows.length > 1 ? rows.filter((x) => x.id !== r.id) : [emptyRow()])}>✕</Button>
              </div>
            ))}
            <Button variant="outline" className="rounded-none border border-border text-xs" onClick={() => setRows([...rows, emptyRow()])}>+ assignee</Button>
          </div>

          <div className="flex items-center gap-3">
            <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" onClick={onSave} disabled={!canSave || saveIdentities.isPending}>
              {saveIdentities.isPending ? "Saving…" : "Save mappings"}
            </Button>
            {saveIdentities.isError && <span role="alert" className="text-xs font-bold text-red-500">{(saveIdentities.error as Error).message}</span>}
            {saveIdentities.isSuccess && <span className="text-xs text-muted-foreground">Saved (names hashed).</span>}
          </div>
        </>
      )}
    </section>
  );
}
