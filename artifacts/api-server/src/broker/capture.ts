import { appendFileSync, readFileSync } from "node:fs";
import { debugAllowed, redactDeep } from "./trace";

/**
 * Capture tape — an ordered, append-only JSONL recording of plane exchanges over
 * time, so a developer can capture activity on one instance and replay it on
 * another (capture.ts records; replay.ts plays back).
 *
 * Each line is one exchange: { seq, ts, plane, method, args, result?, ms, ok,
 * error? }. Payloads are full (replay needs the values) but ALWAYS secret-scrubbed
 * via redactDeep — credentials never reach the tape. The tape is a portable file:
 * copy it to instance B and replay.
 *
 * DEV-ONLY. A capture is real activity written to disk — exactly what the stateless
 * product never does in production — so it is hard-gated: `captureEnabled()` is
 * false under NODE_ENV=production regardless of the flag, and the tape is a
 * developer/CI artifact kept out of the production image. Arm it by pointing
 * BROKER_CAPTURE at a writable path on a non-prod build.
 */

export interface Exchange {
  seq: number;
  ts: string;
  plane: string;
  method: string;
  args: unknown[];
  result?: unknown;
  ms: number;
  ok: boolean;
  error?: Record<string, unknown>;
}

/** The exchange payload the tracer hands us (pre-scrub, no seq/ts yet). */
export interface ExchangeInput {
  plane: string;
  method: string;
  args: unknown[];
  result?: unknown;
  ms: number;
  ok: boolean;
  error?: Record<string, unknown>;
}

/** Is capture armed? (Non-prod + BROKER_CAPTURE points at a path.) */
export function captureEnabled(): boolean {
  return debugAllowed() && !!process.env["BROKER_CAPTURE"]?.trim();
}

/** The armed tape path, or null. */
export function capturePath(): string | null {
  const p = process.env["BROKER_CAPTURE"]?.trim();
  return debugAllowed() && p ? p : null;
}

let seq = 0;

/** Append one (secret-scrubbed) exchange to the armed tape. No-op when disarmed. */
export function recordExchange(input: ExchangeInput): void {
  const path = capturePath();
  if (!path) return;
  const line: Exchange = {
    seq: seq++,
    ts: new Date().toISOString(),
    plane: input.plane,
    method: input.method,
    args: redactDeep(input.args) as unknown[],
    ms: input.ms,
    ok: input.ok,
    ...(input.ok ? { result: redactDeep(input.result) } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
  try {
    appendFileSync(path, JSON.stringify(line) + "\n");
  } catch {
    // A capture failure must never break the request path — it's a dev aid.
  }
}

/** Test-only: reset the per-process sequence counter. */
export function resetCaptureSeq(): void {
  seq = 0;
}

/** Read a tape file into ordered exchanges (skips blank/corrupt lines). */
export function readTape(path: string): Exchange[] {
  const raw = readFileSync(path, "utf8");
  const out: Exchange[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as Exchange);
    } catch {
      // skip a corrupt line rather than abort the whole replay
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}
