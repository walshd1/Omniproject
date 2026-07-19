import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, ArrowDown, Trash2, Plus, Radio } from "lucide-react";
import { CALLOUT_TONES, type DocBlock, type DocBlockType, type CalloutTone } from "@workspace/backend-catalogue";
import { primitivesByFamily } from "../../lib/primitive-store";
import { PrimitiveLibrary } from "../artifact/PrimitiveLibrary";
import { descendantIds, type WikiDoc, type WikiDocInput, type WikiDocSummary } from "../../lib/wiki";
import { useCollabBlocks } from "../../lib/collab";

/**
 * DocEditor — the block-based authoring surface for a wiki document (roadmap 2.1 slice 2). The palette of
 * insertable block types is drawn from the shared primitive store (the `block` family), so authoring can
 * only use blocks that actually render — "documents built of primitives", the same rule the whole product
 * follows. Emits a `WikiDocInput` on save; the server sanitises every field again (the client is never
 * trusted), so this editor only has to be convenient, not authoritative.
 */
const TEXT_TYPES = new Set<DocBlockType>(["paragraph", "quote", "callout", "code"]);
const LIST_TYPES = new Set<DocBlockType>(["bullet-list", "numbered-list", "checklist"]);

let seq = 0;
const newId = () => `b-${Date.now().toString(36)}-${seq++}`;

/** A fresh block of a given type with sensible defaults. */
function blankBlock(type: DocBlockType): DocBlock {
  switch (type) {
    case "heading": return { id: newId(), type, text: "", level: 2 };
    case "callout": return { id: newId(), type, text: "", tone: "info" };
    case "bullet-list": case "numbered-list": case "checklist": return { id: newId(), type, items: [{ text: "" }] };
    case "table": return { id: newId(), type, rows: [["", ""], ["", ""]] };
    case "embed": return { id: newId(), type, url: "", caption: "" };
    case "divider": return { id: newId(), type };
    default: return { id: newId(), type, text: "" };
  }
}

export function DocEditor({ doc, spaceId, docs = [], coEditRoomId = null, coEdit = false, onSave, onCancel, saving }: {
  doc?: WikiDoc;
  spaceId: string;
  /** Sibling docs in this space, for the "parent page" picker (page tree). */
  docs?: WikiDocSummary[];
  /** The co-edit room (e.g. `doc:<id>`) for real-time collaboration; null disables it. */
  coEditRoomId?: string | null;
  /** Whether the wikiCoEdit feature is enabled. */
  coEdit?: boolean;
  onSave: (input: WikiDocInput) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const [title, setTitle] = useState(doc?.title ?? "");
  const initialBlocks = useMemo<DocBlock[]>(
    () => (doc?.blocks?.length ? doc.blocks.map((b) => ({ ...b })) : [blankBlock("paragraph")]),
    [doc],
  );
  // Blocks are backed by the shared Yjs doc when co-edit is on for this room; otherwise plain local state.
  const { blocks, setBlocks, live } = useCollabBlocks(coEditRoomId, initialBlocks, coEdit);
  const [parentId, setParentId] = useState<string>(doc?.parentId ?? "");
  // The insertable block palette comes from the primitive store's `block` family (not a hard-coded list).
  const palette = primitivesByFamily("block");
  // Candidate parents: docs in this space, minus this doc itself and its own descendants (no cycles).
  const excluded = doc ? new Set([doc.id, ...descendantIds(docs, doc.id)]) : new Set<string>();
  const parentOptions = docs.filter((d) => d.spaceId === spaceId && !excluded.has(d.id));

  const patch = (i: number, p: Partial<DocBlock>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    setBlocks(next);
  };
  const remove = (i: number) => setBlocks(blocks.filter((_, j) => j !== i));
  const add = (type: DocBlockType) => setBlocks([...blocks, blankBlock(type)]);

  const canSave = title.trim().length > 0 && !saving;
  const submit = () => onSave({ spaceId, title: title.trim(), blocks, parentId: parentId || null });

  return (
    <div className="space-y-3" data-testid="doc-editor">
      {live && (
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-green-600 dark:text-green-400" data-testid="doc-coedit-live">
          <Radio className="h-3 w-3 animate-pulse" />Live co-editing — changes sync in real time
        </p>
      )}
      <Input aria-label="Document title" data-testid="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" className="text-lg font-bold" />

      {parentOptions.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="uppercase tracking-widest font-bold">Parent page</span>
          <select aria-label="Parent page" data-testid="doc-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} className="h-8 border border-foreground bg-background px-1 text-xs">
            <option value="">— none (top level) —</option>
            {parentOptions.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
      )}

      <div className="space-y-2">
        {blocks.map((b, i) => (
          <div key={b.id} data-testid={`block-${i}`} className="rounded border border-border p-2 space-y-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span className="font-bold">{b.type}</span>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" aria-label={`Move block ${i + 1} up`} onClick={() => move(i, -1)} className="hover:text-foreground"><ArrowUp className="h-3 w-3" /></button>
                <button type="button" aria-label={`Move block ${i + 1} down`} onClick={() => move(i, 1)} className="hover:text-foreground"><ArrowDown className="h-3 w-3" /></button>
                <button type="button" aria-label={`Remove block ${i + 1}`} data-testid={`block-${i}-remove`} onClick={() => remove(i)} className="hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
            <BlockFields block={b} index={i} onPatch={(p) => patch(i, p)} />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1" data-testid="block-palette">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">Add</span>
        {palette.map((p) => (
          <Button key={p.id} type="button" variant="outline" size="sm" className="h-7 text-[11px]" data-testid={`add-block-${p.sourceId}`} onClick={() => add(p.sourceId as DocBlockType)}>
            <Plus className="h-3 w-3 mr-0.5" />{p.label}
          </Button>
        ))}
      </div>

      <details className="border border-border rounded-md p-2" data-testid="doc-primitive-library">
        <summary className="text-[10px] uppercase tracking-widest text-muted-foreground cursor-pointer">Primitive library — what you can embed (incl. your org's activated primitives)</summary>
        <div className="mt-3"><PrimitiveLibrary surface="content" includeActivated /></div>
      </details>

      <div className="flex items-center gap-2 pt-1">
        <Button type="button" size="sm" onClick={submit} disabled={!canSave} data-testid="doc-save">{saving ? "Saving…" : "Save document"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} data-testid="doc-cancel">Cancel</Button>
      </div>
    </div>
  );
}

/** The per-type field editor for one block. */
function BlockFields({ block, index, onPatch }: { block: DocBlock; index: number; onPatch: (p: Partial<DocBlock>) => void }) {
  if (block.type === "divider") return <p className="text-xs text-muted-foreground">A horizontal divider.</p>;

  if (block.type === "heading") {
    return (
      <div className="flex items-center gap-2">
        <select aria-label={`Block ${index + 1} heading level`} value={block.level ?? 2} onChange={(e) => onPatch({ level: Number(e.target.value) })} className="h-8 border border-foreground bg-background px-1 text-xs">
          <option value={1}>H1</option><option value={2}>H2</option><option value={3}>H3</option>
        </select>
        <Input aria-label={`Block ${index + 1} text`} value={block.text ?? ""} onChange={(e) => onPatch({ text: e.target.value })} placeholder="Heading" className="h-8" />
      </div>
    );
  }

  if (TEXT_TYPES.has(block.type)) {
    return (
      <div className="space-y-1">
        {block.type === "callout" && (
          <select aria-label={`Block ${index + 1} tone`} value={block.tone ?? "info"} onChange={(e) => onPatch({ tone: e.target.value as CalloutTone })} className="h-7 border border-foreground bg-background px-1 text-xs">
            {CALLOUT_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <Textarea aria-label={`Block ${index + 1} text`} value={block.text ?? ""} onChange={(e) => onPatch({ text: e.target.value })} placeholder={block.type === "code" ? "code…" : "Write…"} className={block.type === "code" ? "font-mono text-xs" : ""} rows={block.type === "paragraph" ? 3 : 2} />
      </div>
    );
  }

  if (LIST_TYPES.has(block.type)) {
    const items = block.items ?? [];
    const setItems = (next: typeof items) => onPatch({ items: next });
    return (
      <div className="space-y-1">
        {items.map((it, k) => (
          <div key={k} className="flex items-center gap-1">
            {block.type === "checklist" && (
              <input type="checkbox" aria-label={`Item ${k + 1} checked`} checked={!!it.checked} onChange={(e) => setItems(items.map((x, m) => (m === k ? { ...x, checked: e.target.checked } : x)))} />
            )}
            <Input aria-label={`Block ${index + 1} item ${k + 1}`} value={it.text} onChange={(e) => setItems(items.map((x, m) => (m === k ? { ...x, text: e.target.value } : x)))} className="h-7" />
            <button type="button" aria-label={`Remove item ${k + 1}`} onClick={() => setItems(items.filter((_, m) => m !== k))} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setItems([...items, { text: "" }])}>+ item</Button>
      </div>
    );
  }

  if (block.type === "embed") {
    return (
      <div className="space-y-1">
        <Input aria-label={`Block ${index + 1} url`} value={block.url ?? ""} onChange={(e) => onPatch({ url: e.target.value })} placeholder="https://…" className="h-8" />
        <Input aria-label={`Block ${index + 1} caption`} value={block.caption ?? ""} onChange={(e) => onPatch({ caption: e.target.value })} placeholder="Caption (optional)" className="h-7 text-xs" />
      </div>
    );
  }

  if (block.type === "table") {
    // Simple grid: edit cells; add/remove a row or column.
    const rows = block.rows ?? [];
    const setRows = (next: string[][]) => onPatch({ rows: next });
    const cols = rows[0]?.length ?? 0;
    return (
      <div className="space-y-1 overflow-x-auto">
        {rows.map((row, r) => (
          <div key={r} className="flex gap-1">
            {row.map((cell, c) => (
              <Input key={c} aria-label={`Block ${index + 1} row ${r + 1} col ${c + 1}`} value={cell} onChange={(e) => setRows(rows.map((rr, m) => (m === r ? rr.map((cc, n) => (n === c ? e.target.value : cc)) : rr)))} className="h-7 w-24 text-xs" />
            ))}
          </div>
        ))}
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setRows([...rows, Array(Math.max(cols, 1)).fill("")])}>+ row</Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setRows(rows.map((rr) => [...rr, ""]))}>+ column</Button>
        </div>
      </div>
    );
  }

  return null;
}
