import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BookOpen, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../lib/auth";
import { useFeatures, featureEnabled } from "../lib/features";
import { usePresence } from "../lib/presence";
import {
  useWikiSpaces, useWikiDocs, useWikiDoc,
  useCreateWikiDoc, useSaveWikiDoc, useDeleteWikiDoc,
  wikiRoomId, buildDocTree, flattenDocTree, type WikiDocInput,
} from "../lib/wiki";
import { DocRenderer } from "../components/wiki/DocRenderer";
import { DocEditor } from "../components/wiki/DocEditor";
import { PresenceAvatars } from "../components/presence/PresenceAvatars";
import { CommentsPanel } from "../components/issue-dialog/CommentsPanel";

/**
 * Wiki — the collaborative docs / knowledge base page (roadmap 2.1 slice 2). Browse spaces → docs, read a
 * document (rendered from its primitive blocks, with server-resolved backlinks), and author under the
 * existing RBAC ladder: read for anyone (viewer+), create/edit for contributor+, delete for manager+. All
 * content lives in the backend through the broker seam (zero-at-rest); when the connected backend has no
 * wiki, the API answers 501 and this page shows an unsupported notice.
 */
export function Wiki() {
  const { data: auth } = useAuth();
  const { toast } = useToast();
  const spacesQ = useWikiSpaces();
  const [spaceId, setSpaceId] = useState<string>("");
  const [docId, setDocId] = useState<string>("");
  const [mode, setMode] = useState<"view" | "edit" | "new">("view");

  const spaces = Array.isArray(spacesQ.data) ? spacesQ.data : [];
  // Default to the first space once loaded.
  useEffect(() => { if (!spaceId && spaces.length) setSpaceId(spaces[0]!.id); }, [spaces, spaceId]);

  const docsQ = useWikiDocs(spaceId || undefined);
  const docs = (Array.isArray(docsQ.data) ? docsQ.data : []).filter((d) => d.spaceId === spaceId);
  // Nest the flat list into a page tree by parentId; render flattened with per-depth indentation.
  const docTree = flattenDocTree(buildDocTree(docs));
  const docQ = useWikiDoc(mode !== "new" && docId ? docId : undefined);

  const create = useCreateWikiDoc();
  const save = useSaveWikiDoc(docId);
  const del = useDeleteWikiDoc();

  const canAuthor = roleAtLeast(auth?.role, "contributor");
  const canDelete = roleAtLeast(auth?.role, "manager");
  const unsupported = spacesQ.isError; // routes answer 501 → hook errors when the backend has no wiki

  // Live collaboration on the open doc, reusing the shared presence + comments seams keyed by the
  // `doc:<id>` room (same server RBAC as issue comments: read for any authed user, write for
  // contributor+). Gated by the same feature modules as everywhere else; presence only joins while a
  // doc is actually open for reading.
  const { data: features } = useFeatures();
  const presenceOn = featureEnabled(features, "presence");
  const commentsOn = featureEnabled(features, "comments");
  const viewingDocId = mode === "view" && docId ? docId : "";
  const room = viewingDocId ? wikiRoomId(viewingDocId) : null;
  const { peers } = usePresence(room, presenceOn && !!room);

  const onCreate = (input: WikiDocInput) => create.mutate(input, {
    onSuccess: (d) => { setDocId(d.id); setMode("view"); toast({ title: "DOCUMENT CREATED", description: d.title }); },
    onError: (e) => toast({ title: "COULD NOT CREATE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
  });
  const onSave = (input: WikiDocInput) => save.mutate(input, {
    onSuccess: () => { setMode("view"); toast({ title: "DOCUMENT SAVED", description: input.title }); },
    onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
  });
  const onDelete = () => {
    if (!docId) return;
    del.mutate(docId, {
      onSuccess: () => { setDocId(""); setMode("view"); toast({ title: "DOCUMENT DELETED" }); },
      onError: (e) => toast({ title: "COULD NOT DELETE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <div className="p-4 space-y-4" data-testid="wiki-page">
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5" />
        <h1 className="text-xl font-black uppercase tracking-widest">Wiki</h1>
      </div>

      {unsupported ? (
        <p className="text-sm text-muted-foreground" data-testid="wiki-unsupported">The connected backend does not provide a knowledge base.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
          {/* Spaces + doc list */}
          <aside className="space-y-3" data-testid="wiki-nav">
            <div className="flex flex-wrap gap-1" data-testid="wiki-spaces">
              {spaces.map((s) => (
                <button key={s.id} type="button" data-testid={`space-${s.id}`} onClick={() => { setSpaceId(s.id); setDocId(""); setMode("view"); }}
                  className={`px-2 py-0.5 text-xs rounded border ${s.id === spaceId ? "border-foreground bg-muted font-bold" : "border-border text-muted-foreground"}`}>
                  {s.name}
                </button>
              ))}
            </div>
            <ul className="space-y-1" data-testid="wiki-doc-list">
              {docTree.map((d) => (
                <li key={d.id}>
                  <button type="button" data-testid={`doc-link-${d.id}`} data-depth={d.depth} onClick={() => { setDocId(d.id); setMode("view"); }}
                    style={{ paddingLeft: `${0.5 + d.depth * 0.9}rem` }}
                    className={`w-full text-left text-sm pr-2 py-1 rounded ${d.id === docId ? "bg-muted font-bold" : "hover:bg-muted/50"}`}>
                    {d.depth > 0 && <span aria-hidden className="text-muted-foreground mr-1">↳</span>}{d.title}
                  </button>
                </li>
              ))}
              {docs.length === 0 && <li className="text-xs text-muted-foreground px-2" data-testid="wiki-docs-empty">No documents yet.</li>}
            </ul>
            {canAuthor && spaceId && mode !== "new" && (
              <Button type="button" variant="outline" size="sm" data-testid="wiki-new-doc" onClick={() => { setDocId(""); setMode("new"); }}>
                <Plus className="h-3 w-3 mr-1" />New document
              </Button>
            )}
          </aside>

          {/* Main pane */}
          <section className="min-w-0" data-testid="wiki-main">
            {mode === "new" && spaceId && (
              <DocEditor spaceId={spaceId} docs={docs} saving={create.isPending} onCancel={() => setMode("view")} onSave={onCreate} />
            )}
            {mode === "edit" && docQ.data && (
              <DocEditor spaceId={docQ.data.spaceId} doc={docQ.data} docs={docs} saving={save.isPending} onCancel={() => setMode("view")} onSave={onSave} />
            )}
            {mode === "view" && (
              docQ.data ? (
                <article className="space-y-3">
                  <header className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold flex-1 min-w-0">{docQ.data.title}</h2>
                    {presenceOn && peers.length > 0 && <PresenceAvatars peers={peers} />}
                    {canAuthor && <Button type="button" variant="outline" size="sm" data-testid="wiki-edit-doc" onClick={() => setMode("edit")}><Pencil className="h-3 w-3 mr-1" />Edit</Button>}
                    {canDelete && <Button type="button" variant="ghost" size="sm" data-testid="wiki-delete-doc" disabled={del.isPending} onClick={onDelete}><Trash2 className="h-3 w-3 mr-1" />Delete</Button>}
                  </header>
                  <DocRenderer blocks={docQ.data.blocks} />
                  {!!docQ.data.backlinks?.length && (
                    <footer className="border-t border-border pt-2" data-testid="wiki-backlinks">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Linked from</p>
                      <ul className="text-sm space-y-0.5">
                        {docQ.data.backlinks.map((b) => (
                          <li key={b.id}><button type="button" className="text-primary underline" onClick={() => { setSpaceId(b.spaceId); setDocId(b.id); }}>{b.title}</button></li>
                        ))}
                      </ul>
                    </footer>
                  )}
                  {commentsOn && <CommentsPanel roomId={wikiRoomId(docQ.data.id)} />}
                </article>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="wiki-no-selection">Select a document to read, or create one.</p>
              )
            )}
          </section>
        </div>
      )}
    </div>
  );
}
