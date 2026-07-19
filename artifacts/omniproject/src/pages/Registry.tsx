import { useState } from "react";
import { Package, Trash2, Check, X, Globe, Undo2 } from "lucide-react";
import { DataState } from "../components/DataState";
import { useAuth, roleAtLeast } from "../lib/auth";
import {
  useRegistry, useCommunityStatus,
  useSubmitRegistryItem, useReviewRegistryItem, useReleaseRegistryItem, useRetractRegistryItem, useDeleteRegistryItem,
  registryItemKindLabel, type RegistryItemMeta, type ActivationScope,
} from "../lib/registry";
import { safeParseJson } from "../lib/safe-json";
import { useToast } from "@/hooks/use-toast";

/**
 * Org registry (roadmap 3.5). An org-wide store of approved, pure-JSON building blocks. Anyone (contributor+)
 * submits an item; an admin reviews (approve/reject) and may optionally release an approved item to the
 * community. Read is viewer+ (non-admins see approved items + their own). Behind the default-off `registry`
 * module. Reference SKELETONS for authoring live in the repo's `reference-designs/` directory — copy & adapt
 * them; they are never loaded by the app.
 */

const STATUS_TONE: Record<RegistryItemMeta["approvalStatus"], string> = {
  draft: "text-amber-600 border-amber-500/40 bg-amber-500/10",
  approved: "text-green-600 border-green-500/40 bg-green-500/10",
  rejected: "text-red-600 border-red-500/40 bg-red-500/10",
};

function StatusBadge({ status }: { status: RegistryItemMeta["approvalStatus"] }) {
  return <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${STATUS_TONE[status]}`}>{status}</span>;
}

/** Human label for the scope an approved primitive was activated into. */
function scopeLabel(s: ActivationScope): string {
  if (s.kind === "programme") return `Programme ${s.programmeId}`;
  if (s.kind === "project") return `Project ${s.projectId}`;
  return "Org-wide";
}

function SubmitForm({ onDone }: { onDone: () => void }) {
  const submit = useSubmitRegistryItem();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    let submission: unknown;
    try { submission = safeParseJson(text); } catch { setError("That isn't valid JSON."); return; }
    setError(null);
    submit.mutate(submission, {
      onSuccess: (it) => { toast({ title: "SUBMITTED FOR REVIEW", description: `${it.name} · ${registryItemKindLabel(it.kind)}` }); onDone(); },
      onError: () => setError("The submission was rejected — check the kind, name, publisher and payload."),
    });
  };

  return (
    <div className="bg-card border border-border p-4 space-y-2" data-testid="registry-submit-form">
      <p className="text-xs text-muted-foreground">Paste a registry submission (JSON): a <code>kind</code>, <code>name</code>, <code>publisher</code>, <code>version</code>, optional <code>tags</code>, and a pure-JSON <code>payload</code>. Items carry no code.</p>
      <textarea
        data-testid="registry-submission"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder={'{\n  "kind": "report",\n  "name": "Burn rate",\n  "publisher": "Acme",\n  "version": "1.0.0",\n  "tags": ["finance"],\n  "payload": { "id": "burn-rate" }\n}'}
        className="w-full border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {error && <p className="text-xs text-red-600" data-testid="registry-error">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={send} disabled={!text.trim() || submit.isPending} data-testid="registry-submit" className="border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40">{submit.isPending ? "Submitting…" : "Submit for review"}</button>
        <button type="button" onClick={onDone} className="border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40">Cancel</button>
      </div>
    </div>
  );
}

function ItemRow({ item, isAdmin }: { item: RegistryItemMeta; isAdmin: boolean }) {
  const review = useReviewRegistryItem();
  const release = useReleaseRegistryItem();
  const retract = useRetractRegistryItem();
  const del = useDeleteRegistryItem();
  const { toast } = useToast();
  // Primitive approvals can be CONFINED to a scope (downward-only): org-wide (default), or a programme/project
  // the approver holds. Non-primitives ignore this.
  const [scope, setScope] = useState<"org" | "programme" | "project">("org");
  const [scopeId, setScopeId] = useState("");
  const isPrimitive = item.kind === "primitive";

  const approve = () => {
    const args = isPrimitive && scope !== "org"
      ? { id: item.id, decision: "approved" as const, scope, ...(scope === "programme" ? { programmeId: scopeId.trim() } : { projectId: scopeId.trim() }) }
      : { id: item.id, decision: "approved" as const };
    review.mutate(args, {
      onSuccess: () => toast({ title: "APPROVED", description: item.name }),
      onError: () => toast({ title: "APPROVAL FAILED", description: "The scope may be out of your authority, or the primitive isn't safe to activate." }),
    });
  };

  return (
    <div data-testid={`registry-row-${item.id}`} className="border border-border p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold truncate">{item.name}</span>
          <span className="text-xs text-muted-foreground">v{item.version} · {item.publisher}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{registryItemKindLabel(item.kind)}</span>
          <StatusBadge status={item.approvalStatus} />
          {item.visibility === "community" && <span data-testid={`registry-community-${item.id}`} className="text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 text-blue-600 border-blue-500/40 bg-blue-500/10 inline-flex items-center gap-1"><Globe className="w-3 h-3" />Community</span>}
          {isPrimitive && item.approvalStatus === "approved" && item.activatedScope && (
            <span data-testid={`registry-activated-scope-${item.id}`} className="text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 text-purple-600 border-purple-500/40 bg-purple-500/10">{scopeLabel(item.activatedScope)}</span>
          )}
        </div>
        {item.tags.length > 0 && <div className="text-[10px] text-muted-foreground mt-0.5">{item.tags.join(" · ")}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isAdmin && item.approvalStatus === "draft" && (
          <>
            {isPrimitive && (
              <div className="flex items-center gap-1" data-testid={`registry-scope-picker-${item.id}`}>
                <select value={scope} onChange={(e) => setScope(e.target.value as "org" | "programme" | "project")} data-testid={`registry-scope-${item.id}`} className="border border-border bg-background px-1 py-1 text-[10px] uppercase tracking-widest">
                  <option value="org">Org-wide</option>
                  <option value="programme">Programme</option>
                  <option value="project">Project</option>
                </select>
                {scope !== "org" && (
                  <input value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder={scope === "programme" ? "programme id" : "project id"} data-testid={`registry-scope-id-${item.id}`} className="border border-border bg-background px-1 py-1 text-[10px] w-24" />
                )}
              </div>
            )}
            <button type="button" onClick={approve} disabled={isPrimitive && scope !== "org" && !scopeId.trim()} data-testid={`registry-approve-${item.id}`} className="inline-flex items-center gap-1 border border-green-500/50 text-green-700 px-2 py-1 text-xs font-black uppercase tracking-widest hover:bg-green-500/10 disabled:opacity-40"><Check className="w-3 h-3" />Approve</button>
            <button type="button" onClick={() => review.mutate({ id: item.id, decision: "rejected" }, { onSuccess: () => toast({ title: "REJECTED", description: item.name }) })} data-testid={`registry-reject-${item.id}`} className="inline-flex items-center gap-1 border border-red-500/50 text-red-700 px-2 py-1 text-xs font-black uppercase tracking-widest hover:bg-red-500/10"><X className="w-3 h-3" />Reject</button>
          </>
        )}
        {isAdmin && item.approvalStatus === "approved" && item.visibility !== "community" && (
          <button type="button" onClick={() => release.mutate(item.id, { onSuccess: (r) => toast({ title: r.published ? "RELEASED TO COMMUNITY" : "RELEASE QUEUED", description: r.reason ?? item.name }) })} data-testid={`registry-release-${item.id}`} className="inline-flex items-center gap-1 border border-blue-500/50 text-blue-700 px-2 py-1 text-xs font-black uppercase tracking-widest hover:bg-blue-500/10"><Globe className="w-3 h-3" />Release</button>
        )}
        {isAdmin && item.visibility === "community" && (
          <button type="button" onClick={() => retract.mutate(item.id, { onSuccess: () => toast({ title: "RETRACTED", description: item.name }) })} data-testid={`registry-retract-${item.id}`} className="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs font-black uppercase tracking-widest hover:bg-muted/40"><Undo2 className="w-3 h-3" />Retract</button>
        )}
        <button type="button" onClick={() => del.mutate(item.id)} data-testid={`registry-delete-${item.id}`} aria-label="Delete" className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export function Registry() {
  const { data: auth } = useAuth();
  const isAdmin = roleAtLeast(auth?.role, "admin");
  const { data: items, isLoading, isError, error, refetch } = useRegistry();
  const { data: community } = useCommunityStatus();
  const [submitting, setSubmitting] = useState(false);

  const list = items ?? [];
  const pending = list.filter((i) => i.approvalStatus === "draft");
  // Admins get a dedicated review queue for drafts, so the main list shows only decided items (no duplication).
  const rest = isAdmin ? list.filter((i) => i.approvalStatus !== "draft") : list;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black uppercase tracking-widest flex items-center gap-2"><Package className="w-5 h-5" />Registry</h1>
          <p className="text-xs text-muted-foreground">An org-wide store of approved, reusable building blocks — pure JSON, no code.</p>
        </div>
        <div className="flex items-center gap-2">
          <span data-testid="community-status" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{community?.connected ? `Community: ${community.name}` : "Community: not connected"}</span>
          <button type="button" onClick={() => setSubmitting((v) => !v)} data-testid="registry-new" className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest">Submit item</button>
        </div>
      </div>

      {submitting && <SubmitForm onDone={() => setSubmitting(false)} />}

      <p className="text-xs text-muted-foreground" data-testid="reference-hint">
        New to authoring? Copy and adapt a commented skeleton from the repo's <code>reference-designs/</code> directory.
      </p>

      <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
        {isAdmin && pending.length > 0 && (
          <div className="space-y-2" data-testid="registry-review-queue">
            <h2 className="text-sm font-black uppercase tracking-widest text-amber-600">Awaiting review ({pending.length})</h2>
            {pending.map((it) => <ItemRow key={it.id} item={it} isAdmin={isAdmin} />)}
          </div>
        )}
        <div className="space-y-2" data-testid="registry-list">
          {list.length === 0 && !submitting && (
            <p className="text-sm text-muted-foreground">No registry items yet. Submit one — start from a skeleton in the repo's <code>reference-designs/</code> directory.</p>
          )}
          {rest.map((it) => <ItemRow key={it.id} item={it} isAdmin={isAdmin} />)}
        </div>
      </DataState>
    </div>
  );
}
