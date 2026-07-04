import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredCorsOrigins } from "./origin-allowlist";

test("configuredCorsOrigins: empty by default (deny all cross-origin)", () => {
  assert.deepEqual(configuredCorsOrigins({}), new Set());
});

test("configuredCorsOrigins: PUBLIC_URL is trusted (trailing slash + case normalised)", () => {
  assert.deepEqual(
    configuredCorsOrigins({ PUBLIC_URL: "HTTPS://Omni.Example.com/" }),
    new Set(["https://omni.example.com"]),
  );
});

test("configuredCorsOrigins: CORS_ALLOWED_ORIGINS and CSRF_TRUSTED_ORIGINS both contribute, comma-split + deduped", () => {
  const out = configuredCorsOrigins({
    PUBLIC_URL: "https://omni.example.com",
    CORS_ALLOWED_ORIGINS: "https://dash.example.com, https://omni.example.com",
    CSRF_TRUSTED_ORIGINS: "https://embed.example.com",
  });
  assert.deepEqual(out, new Set(["https://omni.example.com", "https://dash.example.com", "https://embed.example.com"]));
});

test("configuredCorsOrigins: blank/whitespace entries are ignored", () => {
  assert.deepEqual(configuredCorsOrigins({ CORS_ALLOWED_ORIGINS: " , ,https://a.example.com, " }), new Set(["https://a.example.com"]));
});
