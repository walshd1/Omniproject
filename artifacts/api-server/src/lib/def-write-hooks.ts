import type { Request, Response } from "express";
import { unwritableMapFields, type FormDef } from "./form-def";
import { resolveCapabilities, type Capabilities } from "./capabilities";
import { isGovernedConfigId, configPayloadId } from "./governed-config-ids";

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
  if (kind === "config") {
    // A `config` def resolves by its LOGICAL id via the scope-layered fold, so the generic importer must NOT be
    // a back door into a GOVERNED config (a security-classified posture control, or the def-scope-policy
    // authoring gate). Those have a dedicated writer that holds a relaxing change for a signed sign-off; writing
    // the same logical id here would fold into the resolved value with none of that. Refuse it — the admin
    // settings surface stays the only writer. See lib/governed-config-ids.
    const id = configPayloadId(payload);
    if (isGovernedConfigId(id)) {
      res.status(403).json({ error: `The "${id}" configuration is governed and can't be authored through the generic def importer — change it on its dedicated admin settings surface (a relaxing change is held for a signed sign-off).` });
      return false;
    }
  }
  if (kind === "form") {
    // A form may only MAP onto issue fields the connected backend can store — the same capability plane that
    // gates the interactive grid. Enforce it at authoring (early, named feedback); the submit path re-checks
    // defensively in case capabilities changed since. `sanitizeDef` already validated the field shapes (type,
    // required params, the writable-target floor), so here we read the declared fields straight off the payload.
    const p = (payload ?? {}) as Record<string, unknown>;
    const def = { fields: Array.isArray(p["fields"]) ? (p["fields"] as FormDef["fields"]) : [] } as FormDef;
    const bad = unwritableMapFields(def, writableIssueFields(await resolveCapabilities(req)));
    if (bad.length > 0) {
      res.status(400).json({ error: `This form maps to issue field(s) the connected backend can't store: ${bad.join(", ")}. Remove the mapping or connect a backend that advertises them.` });
      return false;
    }
  }
  return true;
}
