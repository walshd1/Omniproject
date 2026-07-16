import { Router } from "express";
import { withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import {
  brokerHasWiki, listWikiSpaces, listWikiDocs, getWikiDoc, writeWikiDoc,
  sanitizeWikiDocWrite, resolveBacklinks, WikiError,
} from "../lib/wiki-doc";

/**
 * WIKI / collaborative docs (roadmap 2.1). A knowledge base of documents built of primitive blocks. Bodies
 * live in the backend through the broker seam (zero-at-rest); these routes read/write them under the
 * existing RBAC ladder — read = viewer+, create/update = contributor+, delete = manager+. Every write is
 * sanitised through the one choke point (`sanitizeWikiDocWrite`) before it reaches the broker: nothing a
 * user authors is executed or trusted. The routes answer 501 when the active backend has no wiki.
 *
 * Live collaboration reuses the existing seams, not new ones: presence rooms `doc:<id>` (presence-hub) and
 * comment threads keyed `doc:<id>` (comments), so co-presence, soft-locks and @mention threads work on a
 * document exactly as they do on an issue — no new real-time surface.
 */
const router = Router();

/** Guard: 501 when the active backend doesn't model a wiki. */
function requireWiki(res: import("express").Response): boolean {
  if (!brokerHasWiki()) { res.status(501).json({ error: "this backend does not support a wiki" }); return false; }
  return true;
}

// GET /api/wiki/spaces — the knowledge bases (viewer+).
router.get("/wiki/spaces", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_wiki_spaces failed", async () => {
    if (!requireWiki(res)) return;
    res.json(await listWikiSpaces(req));
  }),
);

// GET /api/wiki/docs?spaceId= — the documents (block bodies omitted), optionally scoped to a space (viewer+).
router.get("/wiki/docs", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_wiki_docs failed", async () => {
    if (!requireWiki(res)) return;
    const spaceId = typeof req.query["spaceId"] === "string" ? req.query["spaceId"] : undefined;
    res.json(await listWikiDocs(req, spaceId));
  }),
);

// GET /api/wiki/docs/:id — one document with its blocks + resolved backlinks (viewer+).
router.get("/wiki/docs/:id", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_wiki_doc failed", async () => {
    if (!requireWiki(res)) return;
    const doc = await getWikiDoc(req, String(req.params["id"]));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    // Backlinks are computed from the corpus' block text (server-side), so a doc always shows who links to it.
    const corpus = await listAllDocsWithBodies(req);
    res.json({ ...doc, backlinks: resolveBacklinks(doc, corpus) });
  }),
);

// POST /api/wiki/docs — create a document (contributor+).
router.post("/wiki/docs", requireRole("contributor"), (req, res) => {
  if (!requireWiki(res)) return;
  let input;
  try { input = sanitizeWikiDocWrite(req.body); }
  catch (e) { if (e instanceof WikiError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "create_wiki_doc failed", async () => {
    res.status(201).json(await writeWikiDoc(req, "create", input));
  });
});

// PUT /api/wiki/docs/:id — update a document (contributor+).
router.put("/wiki/docs/:id", requireRole("contributor"), (req, res) => {
  if (!requireWiki(res)) return;
  let input;
  try { input = sanitizeWikiDocWrite(req.body); }
  catch (e) { if (e instanceof WikiError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "update_wiki_doc failed", async () => {
    const updated = await writeWikiDoc(req, "update", { ...input, id: String(req.params["id"]) });
    res.json(updated);
  });
});

// DELETE /api/wiki/docs/:id — remove a document (manager+).
router.delete("/wiki/docs/:id", requireRole("manager"), (req, res) =>
  withBrokerErrors(req, res, "delete_wiki_doc failed", async () => {
    if (!requireWiki(res)) return;
    await writeWikiDoc(req, "delete", { id: String(req.params["id"]) } as never);
    res.status(204).end();
  }),
);

/** The whole corpus WITH block bodies (for backlink resolution) — the list view omits bodies, so we fetch
 *  each doc. Small in the demo; a real backend would resolve backlinks itself. */
async function listAllDocsWithBodies(req: import("express").Request) {
  const list = await listWikiDocs(req);
  const full = await Promise.all(list.map((d) => getWikiDoc(req, d.id)));
  return full.filter((d): d is NonNullable<typeof d> => d !== null);
}

export default router;
