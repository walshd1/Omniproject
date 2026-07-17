import type { Request, Response } from "express";
import { validateForms, unwritableMapFields } from "./form-def";
import { resolveCapabilities, type Capabilities } from "./capabilities";

/**
 * Request-aware AUTHORING guards that run inside the ONE importer write path (routes/defs `POST`/`PUT`), keyed
 * by def kind. Pure SHAPE validation is `sanitizeDef`'s job; these enforce the cross-cutting, CONTEXT-dependent
 * authoring rules that need the live request — things a static schema can't check. Keeping them here means the
 * rule holds at the single choke point for every def write, no matter which surface authored it.
 *
 * Returns true when allowed; otherwise it has ALREADY sent the response (400) and the caller must return.
 */

/** The issue fields the connected backend advertises as storable (`FieldSupport.store`). */
function writableIssueFields(caps: Capabilities): Set<string> {
  return new Set(Object.entries(caps.fields).filter(([, s]) => s.store).map(([k]) => k));
}

export async function runDefWriteHook(req: Request, res: Response, kind: string, payload: unknown): Promise<boolean> {
  if (kind === "form") {
    // A form may only MAP onto issue fields the connected backend can store — the same capability plane that
    // gates the interactive grid. Enforce it at authoring (early, named feedback); the submit path re-checks
    // defensively in case capabilities changed since. `sanitizeDef` already ran the shape validator, so a
    // parse failure here just means "not a gateable form" — leave it to the shape error already surfaced.
    let forms;
    try { forms = validateForms([payload]); } catch { return true; }
    const bad = unwritableMapFields(forms[0]!, writableIssueFields(await resolveCapabilities(req)));
    if (bad.length > 0) {
      res.status(400).json({ error: `This form maps to issue field(s) the connected backend can't store: ${bad.join(", ")}. Remove the mapping or connect a backend that advertises them.` });
      return false;
    }
  }
  return true;
}
