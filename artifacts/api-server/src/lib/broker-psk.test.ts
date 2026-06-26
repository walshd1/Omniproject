import { test } from "node:test";
import assert from "node:assert/strict";
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

test("seal → open round-trips the exact plaintext", () => {
  withPsk("a-shared-broker-key", () => {
    const msg = JSON.stringify({ action: "create_issue", payload: { title: "secret work" }, auth: "Bearer tok" });
    const token = sealPayload(msg);
    assert.ok(token.startsWith(PSK_PREFIX));
    assert.equal(openPayload(token), msg);
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
