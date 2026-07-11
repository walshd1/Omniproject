import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pskEnabled, sealPayload, openPayload, PSK_PREFIX } from "./broker-psk";

function withPsk<T>(secret: string | undefined, fn: () => T): T {
  const prev = process.env["BROKER_PSK"];
  if (secret === undefined) delete process.env["BROKER_PSK"];
  else process.env["BROKER_PSK"] = secret;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env["BROKER_PSK"];
    else process.env["BROKER_PSK"] = prev;
  }
}

test("pskEnabled reflects BROKER_PSK presence (off by default)", () => {
  withPsk(undefined, () => assert.equal(pskEnabled(), false));
  withPsk("   ", () => assert.equal(pskEnabled(), false)); // whitespace-only is off
  withPsk("a-shared-key", () => assert.equal(pskEnabled(), true));
});

test("seal → open round-trips the exact plaintext (current p2. format)", () => {
  withPsk("a-shared-broker-key", () => {
    const msg = JSON.stringify({ action: "create_issue", payload: { title: "secret work" }, auth: "Bearer tok" });
    const token = sealPayload(msg);
    assert.ok(token.startsWith(PSK_PREFIX));
    assert.equal(PSK_PREFIX, "p2."); // domain-separated HKDF key (audit finding F1)
    assert.equal(openPayload(token), msg);
  });
});

test("openPayload still accepts a legacy p1. token (bare-SHA-256 key), for back-compat", () => {
  withPsk("a-shared-broker-key", () => {
    // Hand-build a p1. token exactly as the pre-migration sealer did: key = SHA-256(secret).
    const key = crypto.createHash("sha256").update("a-shared-broker-key").digest();
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update("legacy plaintext", "utf8"), c.final()]);
    const token = "p1." + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
    assert.equal(openPayload(token), "legacy plaintext");
  });
});

test("a p2. token does NOT open under the legacy key, and vice-versa (domains are separate)", () => {
  withPsk("a-shared-broker-key", () => {
    // A current token is HKDF-keyed; the bare-SHA-256 legacy key can't open it.
    const legacyKey = crypto.createHash("sha256").update("a-shared-broker-key").digest();
    const p2 = sealPayload("x");
    const raw = Buffer.from(p2.slice(3), "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", legacyKey, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    assert.throws(() => Buffer.concat([d.update(raw.subarray(28)), d.final()])); // tag fails under the wrong key
  });
});

test("ciphertext is opaque — no plaintext leaks into the token", () => {
  withPsk("a-shared-broker-key", () => {
    const token = sealPayload(JSON.stringify({ action: "create_issue", auth: "Bearer super-secret-token", title: "Acme merger" }));
    assert.ok(!token.includes("create_issue"));
    assert.ok(!token.includes("super-secret-token"));
    assert.ok(!token.includes("Acme"));
  });
});

test("the IV is random — same plaintext seals to different tokens", () => {
  withPsk("a-shared-broker-key", () => {
    const a = sealPayload("identical");
    const b = sealPayload("identical");
    assert.notEqual(a, b);
    assert.equal(openPayload(a), "identical");
    assert.equal(openPayload(b), "identical");
  });
});

test("tampering fails the auth tag → open returns null (no silent corruption)", () => {
  withPsk("a-shared-broker-key", () => {
    const token = sealPayload("trustworthy");
    // Flip a character in the ciphertext body (after the prefix).
    const body = token.slice(PSK_PREFIX.length);
    const flipped = PSK_PREFIX + (body[0] === "A" ? "B" : "A") + body.slice(1);
    assert.equal(openPayload(flipped), null);
  });
});

test("a wrong key cannot open another key's token", () => {
  const token = withPsk("key-one", () => sealPayload("for key one only"));
  withPsk("key-two", () => assert.equal(openPayload(token), null));
});

test("open is total — returns null on non-sealed / short input instead of throwing", () => {
  withPsk("a-shared-broker-key", () => {
    assert.equal(openPayload("not-a-psk-token"), null);
    assert.equal(openPayload(PSK_PREFIX + "AAAA"), null); // too short for IV+tag
    assert.equal(openPayload(""), null);
  });
});

test("seal throws when no key is configured (fail loud, never plaintext-by-accident)", () => {
  withPsk(undefined, () => assert.throws(() => sealPayload("x"), /BROKER_PSK is not set/));
});
