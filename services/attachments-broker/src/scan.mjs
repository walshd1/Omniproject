/**
 * Upload MALWARE / AV scanning — run INSIDE the hardened sidecar, on the raw bytes, BEFORE a blob is ever
 * stored. This is the one place a (possibly malicious) upload exists, so it is the only correct place to
 * scan it: a file that fails is rejected and never written, so it never becomes downloadable and the gateway
 * never records a pointer for it. Two layers, "as much as we can" without bloating the zero-dependency image:
 *
 *  1. ALWAYS-ON heuristic scan (this file, node built-ins only) — the EICAR antivirus test signature, and
 *     raw executable / script magic bytes (PE, ELF, Mach-O, Java class, shebang scripts). Content-based, so a
 *     renamed `.exe` is still caught. Attachments are documents, not runnables, so executables are refused by
 *     default (an operator can opt in with ATTACHMENTS_SCAN_ALLOW_EXECUTABLES=1).
 *  2. OPTIONAL real AV — when ATTACHMENTS_CLAMAV_ADDRESS points at a ClamAV `clamd`, the bytes are streamed to
 *     it (INSTREAM protocol over a socket, implemented here with node:net — still no npm dependency) for full
 *     signature-based detection. Fail-CLOSED by default: if the scanner is unreachable or errors, the upload
 *     is rejected (set ATTACHMENTS_SCAN_FAIL_OPEN=1 to allow-through in a degraded mode instead).
 */
import net from "node:net";

// The EICAR standard antivirus test string — a harmless, industry-standard file every AV flags, used to
// prove the scan path works. Assembled from fragments so THIS source file never contains the contiguous
// signature (which an AV-scanning CI runner or editor could otherwise quarantine).
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!", "$H+H*"].join("");

/** Executable / script magic signatures refused by default — a document attachment is never one of these. */
const EXECUTABLE_MAGICS = [
  { sig: [0x4d, 0x5a], name: "dos-pe-executable" },        // "MZ" — Windows PE / DOS
  { sig: [0x7f, 0x45, 0x4c, 0x46], name: "elf-executable" }, // \x7f E L F — Linux/Unix
  { sig: [0xfe, 0xed, 0xfa, 0xce], name: "mach-o" },        // Mach-O 32 (BE)
  { sig: [0xfe, 0xed, 0xfa, 0xcf], name: "mach-o-64" },     // Mach-O 64 (BE)
  { sig: [0xcf, 0xfa, 0xed, 0xfe], name: "mach-o-le" },     // Mach-O (LE)
  { sig: [0xca, 0xfe, 0xba, 0xbe], name: "java-class-or-macho-fat" },
  { sig: [0x23, 0x21], name: "script-shebang" },           // "#!" — shell/python/perl scripts
];

const startsWith = (buf, sig) => buf.length >= sig.length && sig.every((b, i) => buf[i] === b);

/**
 * Zero-dependency heuristic scan. Returns `{ ok: true }` when nothing suspicious is found, else
 * `{ ok: false, reason }`. `opts.allowExecutables` suppresses the executable-magic block.
 */
export function heuristicScan(buf, opts = {}) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, reason: "empty" };
  // EICAR test file is tiny; scan only the first 64 KiB so a large upload isn't stringified whole.
  if (buf.subarray(0, 64 * 1024).toString("latin1").includes(EICAR)) return { ok: false, reason: "eicar-test-signature" };
  if (!opts.allowExecutables) {
    for (const m of EXECUTABLE_MAGICS) if (startsWith(buf, m.sig)) return { ok: false, reason: `executable:${m.name}` };
  }
  return { ok: true };
}

/** Split "host:port" (defaulting to clamd's 3310). */
function parseAddress(address) {
  const idx = address.lastIndexOf(":");
  if (idx < 0) return { host: address, port: 3310 };
  return { host: address.slice(0, idx) || "127.0.0.1", port: Number(address.slice(idx + 1)) || 3310 };
}

/**
 * Stream `buf` to a ClamAV `clamd` over the INSTREAM protocol and resolve a verdict. Never throws — a
 * connection/timeout/protocol problem resolves to `{ ok: false, error: true, reason }` so the caller decides
 * fail-open vs fail-closed. `clamd` replies `stream: OK` for clean, `stream: <Sig> FOUND` for a hit.
 */
export function clamdScan(buf, address, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const { host, port } = parseAddress(address);
    let out = "";
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; try { sock.destroy(); } catch { /* already gone */ } resolve(v); };
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => finish({ ok: false, error: true, reason: "clamav-timeout" }), timeoutMs);
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      const CHUNK = 64 * 1024;
      for (let i = 0; i < buf.length; i += CHUNK) {
        const c = buf.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(c.length, 0);
        sock.write(len);
        sock.write(c);
      }
      const end = Buffer.alloc(4); // zero-length chunk terminates the stream
      end.writeUInt32BE(0, 0);
      sock.write(end);
    });
    sock.on("data", (d) => { out += d.toString("utf8"); });
    sock.on("end", () => {
      clearTimeout(timer);
      if (/\bOK\s*\0?\s*$/.test(out)) return finish({ ok: true });
      const found = out.match(/:\s*(.+?)\s+FOUND/);
      if (found) return finish({ ok: false, reason: `clamav:${found[1]}` });
      return finish({ ok: false, error: true, reason: "clamav-protocol-error", detail: out.trim() });
    });
    sock.on("error", (e) => { clearTimeout(timer); finish({ ok: false, error: true, reason: "clamav-unreachable", detail: String(e && e.message ? e.message : e) }); });
  });
}

/**
 * The full scan a blob must pass to be stored: heuristics first (cheap, always on), then ClamAV when
 * configured. `opts`: { clamavAddress, clamavTimeoutMs, failOpen, allowExecutables }. Returns
 * `{ ok: true, degraded? }` or `{ ok: false, reason }`.
 */
export async function scanBlob(buf, opts = {}) {
  const h = heuristicScan(buf, { allowExecutables: opts.allowExecutables });
  if (!h.ok) return h;
  if (opts.clamavAddress) {
    const c = await clamdScan(buf, opts.clamavAddress, opts.clamavTimeoutMs);
    if (!c.ok) {
      // A real detection (no `error` flag) is always fatal. A scanner FAILURE is fatal too unless the
      // operator has explicitly chosen to fail open, in which case we allow it through but flag it degraded.
      if (c.error && opts.failOpen) return { ok: true, degraded: c.reason };
      return c;
    }
  }
  return { ok: true };
}
