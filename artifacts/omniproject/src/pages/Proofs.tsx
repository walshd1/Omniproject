import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Stamp, Plus, Trash2, Save, Check, X, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../lib/auth";
import { useFeatures, featureEnabled } from "../lib/features";
import type { Annotation, DeliverableKind, ProofDecision } from "@workspace/backend-catalogue";
import {
  useProofs, useProof, useCreateProof, useSaveProof, useDeleteProof, useDecideProof,
  proofRoomId, isProofDecisionHeld, type ProofStorage,
} from "../lib/proofs";
import { AnnotationOverlay } from "../components/proof/AnnotationOverlay";
import { CommentsPanel } from "../components/issue-dialog/CommentsPanel";

/**
 * Proofs — the creative-review page (roadmap 2.4 slice 2). Browse proofs, open one to overlay its
 * deliverable (image/PDF) with pin/box/highlight annotations, and record a review decision bound to the
 * version. Content lives in the encrypted-JSON store (storage-target model, sealed at rest); the deliverable
 * is a reference, never uploaded here. RBAC: read viewer+, annotate/author contributor+, delete
 * contributor+ (org proofs manager+). When the `proofing` module is off the API 501s and this shows a notice.
 */
const STORAGE_LABEL: Record<ProofStorage, string> = { user: "Personal", project: "Project", org: "Org-wide" };
const DECISION_STYLE: Record<ProofDecision, string> = {
  pending: "border-border text-muted-foreground",
  approved: "border-green-600 text-green-700",
  rejected: "border-red-600 text-red-700",
  "changes-requested": "border-amber-600 text-amber-700",
};
const DECISION_LABEL: Record<ProofDecision, string> = {
  pending: "Pending", approved: "Approved", rejected: "Rejected", "changes-requested": "Changes requested",
};

export function Proofs() {
  const { data: auth } = useAuth();
  const { toast } = useToast();
  const proofsQ = useProofs();
  const [proofId, setProofId] = useState<string>("");
  const proofQ = useProof(proofId || undefined);

  const create = useCreateProof();
  const save = useSaveProof(proofId);
  const del = useDeleteProof();
  const decide = useDecideProof(proofId);

  const canAuthor = roleAtLeast(auth?.role, "contributor");
  const canManageOrg = roleAtLeast(auth?.role, "manager");
  const unsupported = proofsQ.isError; // 501 → hook errors when the proofing module is off
  const proofs = Array.isArray(proofsQ.data) ? proofsQ.data : [];

  // New-proof form.
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newKind, setNewKind] = useState<DeliverableKind>("image");
  const [newStorage, setNewStorage] = useState<ProofStorage>("user");

  // Working copy of the open proof's annotations; seeded when it loads, saved on demand.
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [dirty, setDirty] = useState(false);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  useEffect(() => {
    if (proofQ.data) { setAnnotations(proofQ.data.annotations ?? []); setDirty(false); }
  }, [proofQ.data]);
  useEffect(() => { setSelectedAnnId(null); }, [proofId]); // reset the open thread when switching proofs

  // Threaded review reuses the shared comments seam, keyed by the `proof:<id>[#<annId>]` room. A selected
  // annotation gets its own thread; otherwise the proof's general-discussion thread.
  const commentsOn = featureEnabled(useFeatures().data, "comments");
  const selectedAnnIndex = selectedAnnId ? annotations.findIndex((a) => a.id === selectedAnnId) : -1;

  const onChange = (next: Annotation[]) => { setAnnotations(next); setDirty(true); };

  const onCreate = () => {
    if (!newName.trim() || !newUrl.trim()) { toast({ title: "NAME + URL REQUIRED", variant: "destructive" }); return; }
    create.mutate(
      { name: newName.trim(), deliverable: { kind: newKind, url: newUrl.trim() }, annotations: [], storage: newStorage },
      {
        onSuccess: (p) => { setProofId(p.id); setNewName(""); setNewUrl(""); toast({ title: "PROOF CREATED", description: `${p.name} · ${STORAGE_LABEL[newStorage]}` }); },
        onError: (e) => toast({ title: "COULD NOT CREATE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
      },
    );
  };
  const onSave = () => {
    if (!proofQ.data) return;
    save.mutate(
      { name: proofQ.data.name, deliverable: proofQ.data.deliverable, annotations },
      {
        onSuccess: () => { setDirty(false); toast({ title: "PROOF SAVED" }); },
        onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
      },
    );
  };
  const onDelete = () => {
    if (!proofId) return;
    del.mutate(proofId, {
      onSuccess: () => { setProofId(""); setAnnotations([]); toast({ title: "PROOF DELETED" }); },
      onError: (e) => toast({ title: "COULD NOT DELETE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };
  const onDecide = (decision: Exclude<ProofDecision, "pending">) => decide.mutate(decision, {
    onSuccess: (r) => isProofDecisionHeld(r)
      ? toast({ title: "SENT FOR SIGN-OFF", description: "This decision needs a signed approval before it takes effect — see the approvals inbox." })
      : toast({ title: "DECISION RECORDED", description: `${DECISION_LABEL[r.decision]} · v${r.decisionVersion ?? r.version}` }),
    onError: (e) => toast({ title: "COULD NOT DECIDE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
  });

  const open = proofQ.data;

  return (
    <div className="p-4 space-y-4" data-testid="proofs-page">
      <div className="flex items-center gap-2">
        <Stamp className="h-5 w-5" />
        <h1 className="text-xl font-black uppercase tracking-widest">Proofs</h1>
      </div>

      {unsupported ? (
        <p className="text-sm text-muted-foreground" data-testid="proofs-unsupported">Proofing is not enabled on this deployment.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
          <aside className="space-y-3" data-testid="proofs-nav">
            <ul className="space-y-1" data-testid="proofs-list">
              {proofs.map((p) => (
                <li key={p.id}>
                  <button type="button" data-testid={`proof-link-${p.id}`} onClick={() => setProofId(p.id)}
                    className={`w-full text-left text-sm px-2 py-1 rounded flex items-center justify-between gap-2 ${p.id === proofId ? "bg-muted font-bold" : "hover:bg-muted/50"}`}>
                    <span className="truncate">{p.name}</span>
                    <span className={`text-[9px] uppercase tracking-widest px-1 py-0.5 rounded border shrink-0 ${DECISION_STYLE[p.decision]}`}>{DECISION_LABEL[p.decision]}</span>
                  </button>
                </li>
              ))}
              {proofs.length === 0 && <li className="text-xs text-muted-foreground px-2" data-testid="proofs-empty">No proofs yet.</li>}
            </ul>

            {canAuthor && (
              <div className="space-y-1 border-t border-border pt-2" data-testid="proof-new-form">
                <Input aria-label="New proof name" data-testid="proof-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Proof name" className="h-8 text-sm" />
                <Input aria-label="Deliverable URL" data-testid="proof-new-url" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Deliverable URL (image/PDF)" className="h-8 text-sm" />
                <div className="flex items-center gap-1">
                  <select aria-label="Deliverable kind" data-testid="proof-new-kind" value={newKind} onChange={(e) => setNewKind(e.target.value as DeliverableKind)} className="h-8 border border-border bg-background text-xs px-1">
                    <option value="image">Image</option>
                    <option value="pdf">PDF</option>
                  </select>
                  <select aria-label="New proof storage" data-testid="proof-new-storage" value={newStorage} onChange={(e) => setNewStorage(e.target.value as ProofStorage)} className="h-8 border border-border bg-background text-xs px-1">
                    <option value="user">Personal</option>
                    {canManageOrg && <option value="org">Org-wide</option>}
                  </select>
                  <Button type="button" variant="outline" size="sm" data-testid="proof-new" disabled={create.isPending} onClick={onCreate}><Plus className="h-3 w-3 mr-1" />New</Button>
                </div>
              </div>
            )}
          </aside>

          <section className="min-w-0" data-testid="proofs-main">
            {open ? (
              <div className="space-y-2">
                <header className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold min-w-0 truncate">{open.name}</h2>
                  <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-border text-muted-foreground" data-testid="proof-storage-badge">{STORAGE_LABEL[open.storage ?? "user"]}</span>
                  <span className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${DECISION_STYLE[open.decision]}`} data-testid="proof-decision-badge">{DECISION_LABEL[open.decision]} · v{open.version}</span>
                  <span className="flex-1" />
                  {canAuthor && <Button type="button" size="sm" data-testid="proof-save" disabled={!dirty || save.isPending} onClick={onSave}><Save className="h-3 w-3 mr-1" />{save.isPending ? "Saving…" : "Save"}</Button>}
                  {canAuthor && (open.storage !== "org" || canManageOrg) &&
                    <Button type="button" variant="ghost" size="sm" data-testid="proof-delete" disabled={del.isPending} onClick={onDelete}><Trash2 className="h-3 w-3 mr-1" />Delete</Button>}
                </header>

                {/* Review decision controls (contributor+; the server gates an org proof to manager+). */}
                {canAuthor && (
                  <div className="flex flex-wrap items-center gap-1" data-testid="proof-decision-bar">
                    <span className="text-xs text-muted-foreground mr-1">Decision:</span>
                    <Button type="button" size="sm" variant="outline" className="text-green-700" data-testid="proof-approve" disabled={decide.isPending} onClick={() => onDecide("approved")}><Check className="h-3 w-3 mr-1" />Approve</Button>
                    <Button type="button" size="sm" variant="outline" className="text-amber-700" data-testid="proof-changes" disabled={decide.isPending} onClick={() => onDecide("changes-requested")}><RotateCcw className="h-3 w-3 mr-1" />Request changes</Button>
                    <Button type="button" size="sm" variant="outline" className="text-red-700" data-testid="proof-reject" disabled={decide.isPending} onClick={() => onDecide("rejected")}><X className="h-3 w-3 mr-1" />Reject</Button>
                    {open.decidedBy && <span className="text-[11px] text-muted-foreground ml-1">by {open.decidedBy}</span>}
                  </div>
                )}

                <AnnotationOverlay deliverable={open.deliverable} annotations={annotations} onChange={onChange} readOnly={!canAuthor} onSelect={setSelectedAnnId} />

                {/* Threaded review — a comment thread per annotation (or the proof's general discussion). */}
                {commentsOn && (
                  <div className="border-t border-border pt-2" data-testid="proof-review-thread">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      {selectedAnnIndex >= 0 ? `Review thread · annotation ${selectedAnnIndex + 1}` : "General review"}
                    </p>
                    <CommentsPanel key={selectedAnnId ?? "general"} roomId={proofRoomId(open.id, selectedAnnId ?? undefined)} />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="proofs-no-selection">Select a proof to review, or create one.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
