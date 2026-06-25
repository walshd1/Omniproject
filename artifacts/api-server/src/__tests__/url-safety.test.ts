import { test } from "node:test";
import assert from "node:assert/strict";

import { assertSafeOutboundUrl, isSafeOutboundUrl, UnsafeUrlError } from "../lib/url-safety";

/**
 * Direct unit tests for outbound-URL safety. The policy ALLOWS public + internal
 * (RFC1918/loopback) http(s) targets and REJECTS non-http(s), malformed URLs, and
 * the link-local/cloud-metadata range (169.254.0.0/16, ::ffff:169.254/.., fe80::/10),
 * including the numeric IPv4 spellings Node canonicalises back to 169.254.169.254.
 */

test("assertSafeOutboundUrl accepts public and internal http(s) URLs", () => {
  const ok = [
    "http://example.com",
    "https://example.com/path?q=1",
    "https://api.example.com:8443/v1/resource",
    "http://n8n:5678", // internal compose hostname
    "http://127.0.0.1:1/x", // loopback explicitly allowed
    "http://192.168.1.10:8080/hook", // RFC1918 internal
  ];
  for (const u of ok) {
    assert.doesNotThrow(() => assertSafeOutboundUrl(u), `expected ${u} to be allowed`);
    assert.equal(isSafeOutboundUrl(u), true, `expected isSafeOutboundUrl(${u}) === true`);
  }
});

test("assertSafeOutboundUrl rejects malformed and non-http(s) URLs", () => {
  const bad = [
    "not a url at all",
    "://missing-scheme",
    "ftp://example.com/file",
    "file:///etc/passwd",
  ];
  for (const u of bad) {
    assert.throws(() => assertSafeOutboundUrl(u), UnsafeUrlError, `expected ${u} to throw`);
    assert.equal(isSafeOutboundUrl(u), false, `expected isSafeOutboundUrl(${u}) === false`);
  }
});

test("assertSafeOutboundUrl rejects the cloud-metadata address (dotted decimal)", () => {
  assert.throws(() => assertSafeOutboundUrl("http://169.254.169.254/"), UnsafeUrlError);
  assert.equal(isSafeOutboundUrl("http://169.254.169.254/"), false);
});

test("assertSafeOutboundUrl rejects numeric IPv4 spellings of 169.254.169.254", () => {
  // Node's URL parser canonicalises these to dotted-decimal 169.254.169.254.
  const numeric = [
    "http://2852039166/", // decimal
    "http://0xA9FEA9FE/", // hex
    "http://0xa9fea9fe/", // hex lowercase
  ];
  for (const u of numeric) {
    assert.throws(() => assertSafeOutboundUrl(u), UnsafeUrlError, `expected ${u} to throw`);
    assert.equal(isSafeOutboundUrl(u), false, `expected isSafeOutboundUrl(${u}) === false`);
  }
});

test("assertSafeOutboundUrl rejects the IPv4-mapped IPv6 metadata literal", () => {
  const u = "http://[::ffff:169.254.169.254]/";
  assert.throws(() => assertSafeOutboundUrl(u), UnsafeUrlError);
  assert.equal(isSafeOutboundUrl(u), false);
});

test("assertSafeOutboundUrl rejects IPv6 link-local literals", () => {
  const u = "http://[fe80::1]/";
  assert.throws(() => assertSafeOutboundUrl(u), UnsafeUrlError);
  assert.equal(isSafeOutboundUrl(u), false);
});

test("UnsafeUrlError uses the provided label in its message", () => {
  assert.throws(
    () => assertSafeOutboundUrl("ftp://x", "brokerUrl"),
    (err: unknown) => {
      assert.ok(err instanceof UnsafeUrlError);
      assert.equal(err.name, "UnsafeUrlError");
      assert.match(err.message, /brokerUrl/);
      return true;
    },
  );
});
