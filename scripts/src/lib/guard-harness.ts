/**
 * Shared reporting tail for the read-only `guard-*.ts` drift/consistency checks.
 *
 * Every guard walked the repo, collected a `string[]` of violations, and then re-wrote the same
 * dozen lines: on a violation, print a headline + the bulleted list (+ remediation help) and
 * `process.exit(1)`; otherwise log a one-line OK summary. This centralises that tail so every guard
 * fails CI the same way — a GitHub `::error::` annotation surfaces each failure inline — and the
 * boilerplate lives in one unit-tested place.
 */
export interface GuardReport {
  /** One entry per violation; an empty array means the guard passed. */
  violations: string[];
  /** The one-line summary printed on success, after `"<name> guard: OK — "`. */
  okSummary: string;
  /** Optional remediation printed after the violation list on failure. */
  help?: string;
  /** Optional failure headline; defaults to `"<name> guard failed"`. */
  failHeadline?: string;
}

export interface GuardOutcome {
  ok: boolean;
  /** Lines destined for stdout (the OK summary on success). */
  stdout: string[];
  /** Lines destined for stderr (the headline + violations + help on failure). */
  stderr: string[];
}

/** Pure formatter — turns a report into the exact lines to print, without touching the console or
 *  the process. Kept separate from `reportGuard` so it can be unit-tested. */
export function formatGuard(name: string, report: GuardReport): GuardOutcome {
  if (report.violations.length > 0) {
    const stderr = [`::error::${report.failHeadline ?? `${name} guard failed`}`];
    for (const v of report.violations) stderr.push(`  - ${v}`);
    if (report.help) stderr.push("", report.help);
    return { ok: false, stdout: [], stderr };
  }
  return { ok: true, stdout: [`${name} guard: OK — ${report.okSummary}`], stderr: [] };
}

/** Print a guard's outcome in the house style and `process.exit(1)` on any violation. */
export function reportGuard(name: string, report: GuardReport): void {
  const outcome = formatGuard(name, report);
  for (const l of outcome.stdout) console.log(l);
  for (const l of outcome.stderr) console.error(l);
  if (!outcome.ok) process.exit(1);
}
