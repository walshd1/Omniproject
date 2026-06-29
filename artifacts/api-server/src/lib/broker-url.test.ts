import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredBrokerUrl, configuredBrokerUrls } from "./broker-url";

test("configuredBrokerUrls gathers every loaded broker endpoint, de-duplicated", () => {
  const urls = configuredBrokerUrls({
    BROKER_URL: "https://primary/webhook",
    BROKER_URLS: "https://primary/webhook, https://pool-b/webhook", // dup + a second
    BROKER_ENDPOINTS: "node-red=http://nr:1880/a|http://nr2:1880/b,extra=https://x/y",
    N8N_WEBHOOK_URL: "https://legacy/webhook",
  });
  assert.deepEqual(urls, [
    "https://primary/webhook",
    "https://pool-b/webhook",
    "http://nr:1880/a",
    "http://nr2:1880/b",
    "https://x/y",
    "https://legacy/webhook",
  ]);
});

test("configuredBrokerUrls is empty when nothing is configured; honours the legacy alias alone", () => {
  assert.deepEqual(configuredBrokerUrls({}), []);
  assert.deepEqual(configuredBrokerUrls({ N8N_WEBHOOK_URL: " https://legacy/ " }), ["https://legacy/"]);
});

test("configuredBrokerUrl returns the primary (first) endpoint or undefined", () => {
  assert.equal(configuredBrokerUrl({ BROKER_URL: "https://a/" }), "https://a/");
  assert.equal(configuredBrokerUrl({ BROKER_ENDPOINTS: "k=https://only/" }), "https://only/"); // falls through
  assert.equal(configuredBrokerUrl({}), undefined);
});
