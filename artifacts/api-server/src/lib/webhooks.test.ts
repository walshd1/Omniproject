import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  createWebhook, deleteWebhook, getWebhook, listWebhooks, redact,
  signBody, deliverWebhooks, emitWebhookEvent, testWebhook, WebhookNotFoundError,
} from "./webhooks";
import { updateSettings } from "./settings";

/**
 * Outbound webhooks (premium `webhooks`, granted by default in the pre-community period).
 * Validation + CRUD are pure; delivery is fire-and-forget against a real local HTTP endpoint.
 */
afterEach(() => {
  updateSettings({ webhooks: [] });
  delete process.env["PREMIUM_ENFORCEMENT"];
});

function startSink(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => handler(req, res, body));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook` }));
  });
}

test("createWebhook validates input and mints an id + secret; redact hides the secret", () => {
  assert.throws(() => createWebhook(null), /must be an object/);
  assert.throws(() => createWebhook({ url: "ftp://x" }), /absolute http/);
  assert.throws(() => createWebhook({ url: "http://169.254.169.254/x" }), /link-local|metadata/i);

  const sub = createWebhook({ url: "https://example.com/hook", events: ["notification", "unknown.event"], description: "x".repeat(300) });
  assert.ok(sub.id && sub.secret);
  assert.deepEqual(sub.events, ["notification"]); // unknown event filtered out
  assert.equal(sub.description!.length, 200); // clamped

  const red = redact(sub);
  assert.equal((red as { secret?: string }).secret, undefined);
  assert.equal(red.secretSet, true);
  assert.equal(listWebhooks().length, 1);
});

test("createWebhook defaults events to '*' and accepts a caller-supplied secret", () => {
  const sub = createWebhook({ url: "https://example.com/h", secret: "my-secret", events: [] });
  assert.deepEqual(sub.events, ["*"]);
  assert.equal(sub.secret, "my-secret");
});

test("getWebhook / deleteWebhook: found and not-found paths", () => {
  const sub = createWebhook({ url: "https://example.com/h" });
  assert.equal(getWebhook(sub.id)!.id, sub.id);
  assert.equal(getWebhook("nope"), undefined);
  deleteWebhook(sub.id);
  assert.equal(getWebhook(sub.id), undefined);
  assert.throws(() => deleteWebhook("nope"), WebhookNotFoundError);
});

test("signBody is a deterministic HMAC with the scheme prefix", () => {
  const a = signBody("payload", "secret");
  assert.match(a, /^sha256=[0-9a-f]{64}$/);
  assert.equal(signBody("payload", "secret"), a);
  assert.notEqual(signBody("payload", "other"), a);
});

test("deliverWebhooks fans out to matching active subscriptions and signs the body", async () => {
  let received: { headers: http.IncomingHttpHeaders; body: string } | null = null;
  const { server, url } = await startSink((req, res, body) => {
    received = { headers: req.headers, body };
    res.writeHead(200); res.end("ok");
  });
  try {
    const sub = createWebhook({ url, events: ["notification"], secret: "s3cr3t" });
    const results = await deliverWebhooks("notification", { id: "I1" });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.ok, true);
    assert.equal(results[0]!.status, 200);
    assert.ok(received);
    const env = JSON.parse(received!.body) as { event: string; data: { id: string } };
    assert.equal(env.event, "notification");
    assert.equal(env.data.id, "I1");
    assert.equal(received!.headers["x-omniproject-signature"], signBody(received!.body, sub.secret));
  } finally {
    server.close();
  }
});

test("deliverWebhooks skips non-matching events and inactive subscriptions", async () => {
  createWebhook({ url: "https://example.com/h", events: ["notification"], active: false });
  assert.deepEqual(await deliverWebhooks("notification", {}), []); // inactive → no target
  createWebhook({ url: "https://example.com/h2", events: ["audit"] });
  assert.deepEqual(await deliverWebhooks("config.changed", {}), []); // event not subscribed
});

test("deliverWebhooks is a no-op when the webhooks entitlement is off", async () => {
  process.env["PREMIUM_ENFORCEMENT"] = "on"; // paywall webhooks (no licence)
  createWebhook({ url: "https://example.com/h" });
  assert.deepEqual(await deliverWebhooks("notification", {}), []);
});

test("a delivery to an unreachable target degrades to ok:false (never throws)", async () => {
  const sub = createWebhook({ url: "http://127.0.0.1:1/hook" }); // nothing listening on port 1
  const result = await testWebhook(sub.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.ok(result.error);
});

test("testWebhook throws for an unknown id", async () => {
  await assert.rejects(() => testWebhook("nope"), WebhookNotFoundError);
});

test("emitWebhookEvent does not throw (fire-and-forget)", () => {
  assert.doesNotThrow(() => emitWebhookEvent("notification", { id: "x" }));
});
