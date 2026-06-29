import { evaluateRuleset } from "./ruleset";
import type { Broker, ActorContext } from "../broker/types";
import type { Role } from "./rbac";

/**
 * Tabular import — the write JOB, separated from the HTTP shell (routes/import.ts). Given a set
 * of already-mapped row payloads, write each one through the active broker, honouring the
 * business ruleset PER ROW exactly as a single hand-typed create would. Pure of Express: it
 * takes the broker + context and returns a per-row outcome, so it's unit-testable without a
 * request. No data is stored here — rows flow straight to the broker.
 */

export interface ImportOutcome {
  created: { row: number; id: string }[];
  skipped: { row: number; reason: string; rule?: string }[];
}

export interface CommitImportInput {
  broker: Broker;
  ctx: ActorContext;
  role: Role;
  projectId: string;
  payloads: Record<string, unknown>[];
  /** Per-row error logger (the request log, typically). */
  onRowError?: (row: number, err: unknown) => void;
}

/** Write each mapped payload as an issue, skipping (never forcing) rows blocked by a missing
 *  title, the ruleset, or a broker error. */
export async function commitImport(input: CommitImportInput): Promise<ImportOutcome> {
  const { broker, ctx, role, projectId, payloads, onRowError } = input;
  const created: ImportOutcome["created"] = [];
  const skipped: ImportOutcome["skipped"] = [];

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i]!;
    if (typeof payload["title"] !== "string" || !payload["title"]) {
      skipped.push({ row: i, reason: "missing title" });
      continue;
    }
    // Business ruleset (restrict-only) runs per row, exactly as a single create would.
    const verdict = evaluateRuleset({ action: "create_issue", write: true, role, projectId, payload });
    if (!verdict.allow) {
      skipped.push({ row: i, reason: verdict.blocked!.message, rule: verdict.blocked!.id });
      continue;
    }
    try {
      const issue = await broker.writeIssue(ctx, "create", { projectId, ...payload });
      if (!issue?.id) {
        skipped.push({ row: i, reason: "broker returned no issue" });
        continue;
      }
      created.push({ row: i, id: issue.id });
    } catch (err) {
      onRowError?.(i, err);
      skipped.push({ row: i, reason: err instanceof Error ? err.message : "broker error" });
    }
  }

  return { created, skipped };
}
