/**
 * Upload/download TICKETS — the capability the browser presents to the sidecar so it never needs the
 * admin bearer token. The GATEWAY mints a ticket (it holds the shared secret); the browser sends it to
 * the sidecar's `/portal/*` endpoints; the sidecar VERIFIES it here. A ticket is scoped to one op + one
 * storage key + a room, and expires quickly — so a leaked ticket can't be replayed against another blob
 * or after its short window. This keeps file BYTES on the browser↔sidecar path only; the gateway holds
 * just metadata + a link.
 *
 * Format: `<base64url(payloadJSON)>.<base64url(HMAC-SHA256(payloadJSON, secret))>`.
 * Payload: `{ op: "put"|"get", key, room, exp }` (exp = epoch ms).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Sign a payload object into a ticket string (used by tests + the gateway's mirror of this helper). */
export function signTicket(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

/**
 * Verify a ticket against the shared secret and the expected op + key. Returns the payload on success, or
 * null on any failure (bad shape, bad signature, wrong op/key, or expired). `now` is injectable for tests.
 */
export function verifyTicket(ticket, secret, expected, now = Date.now()) {
  if (typeof ticket !== "string" || !secret) return null;
  const dot = ticket.indexOf(".");
  if (dot < 1) return null;
  const body = ticket.slice(0, dot);
  const mac = ticket.slice(dot + 1);
  const want = b64url(createHmac("sha256", secret).update(body).digest());
  const got = Buffer.from(mac);
  const exp = Buffer.from(want);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.op !== expected.op) return null;
  if (payload.key !== expected.key) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload;
}
