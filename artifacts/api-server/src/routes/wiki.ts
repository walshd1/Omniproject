import crypto from "node:crypto";
import { Router } from "express";
import type { Request } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import type { WikiDoc, WikiSpace } from "../broker/types";
import { requireRole } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { authorizeStorageTarget } from "../lib/storage-target-authz";
import {
  artifactStoreEnabled, listArtifacts, getArtifact, putArtifact, deleteArtifact,
  type ArtifactScope,
} from "../lib/artifact-store";
import {
  brokerHasWiki, listWikiSpaces, listWikiDocs, getWikiDoc, writeWikiDoc,
  brokerHasWikiVersions, listWikiDocVersions, getWikiDocVersion,
  sanitizeWikiDocWrite, resolveBacklinks, WikiError,
  WIKI_DOC_ARTIFACT, makeWikiDocId, parseWikiDocId, wikiDocScope,
  newJsonDocRow, mergeJsonDocRow, docSummary,
  captureJsonDocVersion, listJsonDocVersions, getJsonDocVersion,
} from "../lib/wiki-doc";

/**
 * WIKI / collaborative docs (roadmap 2.1). A knowledge base of documents built of primitive blocks. A page
 * is saved to a STORAGE TARGET the author chooses — the same pattern as whiteboards, applied "across the
 * board":
 *   - `user`     the author's PRIVATE encrypted-JSON area (default; only they see it),
 *   - `project`  a project's shared encrypted-JSON area (project-scope gated),
 *   - `org`      the org-wide shared encrypted-JSON area (writing needs manager+),
 *   - `sidecar`  the built-in system-of-record (the broker), when it models a wiki.
 * Every JSON collection is AES-256-GCM sealed at rest (see lib/artifact-store), so zero-at-rest holds. Doc
 * ids are SELF-DESCRIBING (`<target>~…<localId>`), so a later read/write routes to the right store with no
 * lookup; a `user` scope always uses the caller's own sub (cross-user is structurally impossible). Every
 * write passes the one sanitising choke point (`sanitizeWikiDocWrite`): block bodies are neutral JSON, never
 * HTML, so there is no markup sink. RBAC floors: read viewer+, author contributor+, delete contributor+
 * (org writes/deletes additionally need manager+).
 *
 * Live collaboration reuses the existing seams: presence rooms `doc:<id>` and comment threads keyed
 * `doc:<id>` — co-presence, soft-locks and @mention threads work on a document exactly as on an issue.
 */
const router = Router();

/** Whether ANY wiki backing is available (the encrypted-JSON store or a broker that models a wiki). */
const wikiAvailable = (): boolean => artifactStoreEnabled() || brokerHasWiki();
/** Guard: 501 when neither the JSON store nor a broker wiki is available. */
function requireWiki(res: import("express").Response): boolean {
  if (!wikiAvailable()) { res.status(501).json({ error: "this backend does not support a wiki" }); return false; }
  return true;
}

/** Per-target authorization for one wiki operation (the shared storage-target gate). */
const authorizeTarget = (
  req: Parameters<typeof authorizeStorageTarget>[0], res: Parameters<typeof authorizeStorageTarget>[1],
  storage: Parameters<typeof authorizeStorageTarget>[2], projectId: string | undefined, op: "read" | "write",
): Promise<boolean> =>
  authorizeStorageTarget(req, res, storage, projectId, op, {
    capability: brokerHasWiki(), capabilityError: "this backend does not support a wiki",
  });

/** The caller's readable JSON scopes: their own user area + the org area (project areas are added per-request
 *  once a projectId is known to be in scope). Empty when the JSON store is disabled. */
function baseJsonScopes(sub: string | undefined): ArtifactScope[] {
  if (!artifactStoreEnabled()) return [];
  const scopes: ArtifactScope[] = [{ kind: "org" }];
  if (sub) scopes.unshift({ kind: "user", sub });
  return scopes;
}

/** Sidecar docs, ids rewritten to self-describing `sidecar~…` form so later reads route back to the broker. */
async function sidecarDocs(req: Request, spaceId?: string): Promise<WikiDoc[]> {
  if (!brokerHasWiki()) return [];
  return (await listWikiDocs(req, spaceId)).map((d) => ({ ...d, id: makeWikiDocId("sidecar", d.id) }));
}

/** The whole corpus (WITH block bodies) the caller can see — for backlink resolution across every accessible
 *  store. JSON rows already carry their blocks; sidecar docs are fetched individually (the list omits them). */
async function aggregatedCorpus(req: Request, extraProjectId?: string): Promise<WikiDoc[]> {
  const ctx = contextFromReq(req);
  const out: WikiDoc[] = [];
  const scopes = baseJsonScopes(ctx.sub);
  if (extraProjectId && artifactStoreEnabled()) scopes.push({ kind: "project", projectId: extraProjectId });
  for (const scope of scopes) out.push(...listArtifacts<WikiDoc>(WIKI_DOC_ARTIFACT, scope));
  if (brokerHasWiki()) {
    const list = await listWikiDocs(req);
    const full = await Promise.all(list.map((d) => getWikiDoc(req, d.id)));
    for (const d of full) if (d) out.push({ ...d, id: makeWikiDocId("sidecar", d.id) });
  }
  return out;
}

// GET /api/wiki/spaces — the knowledge bases: broker spaces + a fallback "General" + a synthesised space for
// any spaceId referenced by accessible JSON docs (so a JSON-only deployment can still group + create) (viewer+).
router.get("/wiki/spaces", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_wiki_spaces failed", async () => {
    if (!requireWiki(res)) return;
    const spaces = new Map<string, WikiSpace>();
    if (brokerHasWiki()) for (const s of await listWikiSpaces(req)) spaces.set(s.id, s);
    if (!spaces.has("general")) spaces.set("general", { id: "general", key: "general", name: "General", description: null });
    const ctx = contextFromReq(req);
    for (const scope of baseJsonScopes(ctx.sub)) {
      for (const d of listArtifacts<WikiDoc>(WIKI_DOC_ARTIFACT, scope)) {
        if (d.spaceId && !spaces.has(d.spaceId)) spaces.set(d.spaceId, { id: d.spaceId, key: d.spaceId, name: d.spaceId, description: null });
      }
    }
    res.json([...spaces.values()]);
  }),
);

// GET /api/wiki/docs?spaceId=&projectId= — the documents (block bodies omitted) across every accessible store:
// the caller's private area, the org area, a requested project's area (when in scope) and the sidecar (viewer+).
router.get("/wiki/docs", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_wiki_docs failed", async () => {
    if (!requireWiki(res)) return;
    const spaceId = typeof req.query["spaceId"] === "string" ? req.query["spaceId"] : undefined;
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const ctx = contextFromReq(req);
    const docs: WikiDoc[] = [];
    const scopes = baseJsonScopes(ctx.sub);
    if (projectId && artifactStoreEnabled() && (await assertProjectScope(req, projectId)).ok) scopes.push({ kind: "project", projectId });
    for (const scope of scopes) docs.push(...listArtifacts<WikiDoc>(WIKI_DOC_ARTIFACT, scope));
    docs.push(...(await sidecarDocs(req, spaceId)));
    const filtered = spaceId ? docs.filter((d) => d.spaceId === spaceId) : docs;
    res.json(filtered.map(docSummary)); // list omits block bodies
  }),
);

// GET /api/wiki/docs/:id — one document with its blocks + resolved backlinks (viewer+).
router.get("/wiki/docs/:id", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_wiki_doc failed", async () => {
    if (!requireWiki(res)) return;
    const id = String(req.params["id"]);
    const parsed = parseWikiDocId(id);
    if (!parsed) { res.status(404).json({ error: "Document not found" }); return; }
    let doc: WikiDoc | null = null;
    if (parsed.storage === "sidecar") {
      if (!brokerHasWiki()) { res.status(501).json({ error: "this backend does not support a wiki" }); return; }
      const found = await getWikiDoc(req, parsed.localId);
      doc = found ? { ...found, id } : null;
    } else {
      if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "read"))) return;
      const scope = wikiDocScope(parsed, contextFromReq(req).sub);
      doc = scope ? getArtifact<WikiDoc>(WIKI_DOC_ARTIFACT, scope, id) : null;
    }
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    const corpus = await aggregatedCorpus(req, parsed.projectId);
    res.json({ ...doc, backlinks: resolveBacklinks(doc, corpus) });
  }),
);

// GET /api/wiki/docs/:id/versions — the document's saved revisions, newest first (viewer+).
router.get("/wiki/docs/:id/versions", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_wiki_doc_versions failed", async () => {
    if (!requireWiki(res)) return;
    const id = String(req.params["id"]);
    const parsed = parseWikiDocId(id);
    if (!parsed) { res.status(404).json({ error: "Document not found" }); return; }
    if (parsed.storage === "sidecar") {
      if (!brokerHasWikiVersions()) { res.status(501).json({ error: "this backend does not retain document history" }); return; }
      res.json(await listWikiDocVersions(req, parsed.localId));
      return;
    }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "read"))) return;
    const scope = wikiDocScope(parsed, contextFromReq(req).sub);
    res.json(scope ? listJsonDocVersions(scope, id) : []);
  }),
);

// GET /api/wiki/docs/:id/versions/:versionId — one revision with its blocks, for preview / diff / restore (viewer+).
router.get("/wiki/docs/:id/versions/:versionId", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_wiki_doc_version failed", async () => {
    if (!requireWiki(res)) return;
    const id = String(req.params["id"]);
    const versionId = String(req.params["versionId"]);
    const parsed = parseWikiDocId(id);
    if (!parsed) { res.status(404).json({ error: "Version not found" }); return; }
    if (parsed.storage === "sidecar") {
      if (!brokerHasWikiVersions()) { res.status(501).json({ error: "this backend does not retain document history" }); return; }
      const version = await getWikiDocVersion(req, parsed.localId, versionId);
      if (!version) { res.status(404).json({ error: "Version not found" }); return; }
      res.json(version);
      return;
    }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "read"))) return;
    const scope = wikiDocScope(parsed, contextFromReq(req).sub);
    const version = scope ? getJsonDocVersion(scope, id, versionId) : null;
    if (!version) { res.status(404).json({ error: "Version not found" }); return; }
    res.json(version);
  }),
);

// POST /api/wiki/docs — create a document in the chosen storage target (contributor+).
router.post("/wiki/docs", requireRole("contributor"), (req, res) => {
  if (!requireWiki(res)) return;
  let input;
  try { input = sanitizeWikiDocWrite(req.body); }
  catch (e) { if (e instanceof WikiError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "create_wiki_doc failed", async () => {
    if (!(await authorizeTarget(req, res, input.storage, input.projectId, "write"))) return;
    if (input.storage === "sidecar") {
      res.status(201).json(await writeWikiDoc(req, "create", input).then((d) => (d ? { ...d, id: makeWikiDocId("sidecar", d.id) } : d)));
      return;
    }
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
    const ctx = contextFromReq(req);
    const scope = wikiDocScope(input, ctx.sub);
    if (!scope) { res.status(400).json({ error: "invalid storage target" }); return; }
    const id = makeWikiDocId(input.storage, crypto.randomUUID(), input.projectId);
    const row = newJsonDocRow(id, input, ctx, new Date().toISOString());
    putArtifact(WIKI_DOC_ARTIFACT, scope, row);
    captureJsonDocVersion(scope, row, `wv-${crypto.randomUUID()}`);
    res.status(201).json(row);
  });
});

// PUT /api/wiki/docs/:id — update a document in place (contributor+); the id governs which store is written.
router.put("/wiki/docs/:id", requireRole("contributor"), (req, res) => {
  if (!requireWiki(res)) return;
  let input;
  try { input = sanitizeWikiDocWrite(req.body); }
  catch (e) { if (e instanceof WikiError) { res.status(400).json({ error: e.message }); return; } throw e; }
  const id = String(req.params["id"]);
  const parsed = parseWikiDocId(id);
  if (!parsed) { res.status(404).json({ error: "Document not found" }); return; }
  return withBrokerErrors(req, res, "update_wiki_doc failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (parsed.storage === "sidecar") {
      const updated = await writeWikiDoc(req, "update", { ...input, id: parsed.localId });
      res.json(updated ? { ...updated, id } : updated);
      return;
    }
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Document not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = wikiDocScope(parsed, ctx.sub);
    if (!scope) { res.status(404).json({ error: "Document not found" }); return; }
    const existing = getArtifact<WikiDoc>(WIKI_DOC_ARTIFACT, scope, id);
    if (!existing) { res.status(404).json({ error: "Document not found" }); return; }
    const row = mergeJsonDocRow(existing, input, ctx, new Date().toISOString());
    putArtifact(WIKI_DOC_ARTIFACT, scope, row);
    captureJsonDocVersion(scope, row, `wv-${crypto.randomUUID()}`);
    res.json(row);
  });
});

// DELETE /api/wiki/docs/:id — remove a document (contributor+; the org target additionally needs manager+).
router.delete("/wiki/docs/:id", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "delete_wiki_doc failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseWikiDocId(id);
    if (!parsed) { res.status(204).end(); return; } // malformed id → nothing to delete (idempotent)
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (parsed.storage === "sidecar") {
      await writeWikiDoc(req, "delete", { id: parsed.localId } as never);
      res.status(204).end();
      return;
    }
    if (!artifactStoreEnabled()) { res.status(204).end(); return; }
    const scope = wikiDocScope(parsed, contextFromReq(req).sub);
    if (scope) deleteArtifact(WIKI_DOC_ARTIFACT, scope, id);
    res.status(204).end();
  }),
);

export default router;
