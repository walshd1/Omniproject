import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestBackendPrompt, parseSuggestedManifest, SuggestParseError } from "./backend-suggest";

test("suggestBackendPrompt names the vendor and forbids inventing actions", () => {
  const prompt = suggestBackendPrompt("Smartsheet");
  assert.match(prompt, /Vendor \/ product name: Smartsheet/);
  assert.match(prompt, /Do NOT include an "actions" field/);
  assert.match(prompt, /NO live internet access/);
});

test("suggestBackendPrompt appends an optional requester hint", () => {
  const prompt = suggestBackendPrompt("Smartsheet", "we use their REST API v2");
  assert.match(prompt, /Additional context supplied by the requester: we use their REST API v2/);
});

test("parseSuggestedManifest extracts a well-formed reply", () => {
  const reply = JSON.stringify({
    id: "smartsheet",
    label: "Smartsheet",
    docsUrl: "https://developers.smartsheet.com",
    via: "API key",
    requiredEnv: ["SMARTSHEET_API_BASE"],
    capabilities: { issues: true, financials: false, notAKnownDomain: true },
    notes: "AI-suggested, unverified — review before use. Guessing at field names.",
  });
  const manifest = parseSuggestedManifest(reply, "Smartsheet");
  assert.equal(manifest["id"], "smartsheet");
  assert.equal(manifest["label"], "Smartsheet");
  assert.equal(manifest["docsUrl"], "https://developers.smartsheet.com");
  assert.deepEqual(manifest["requiredEnv"], ["SMARTSHEET_API_BASE"]);
  // Unknown capability keys are dropped — only recognised domains pass through.
  assert.deepEqual(manifest["capabilities"], { issues: true, financials: false });
  assert.ok(!("actions" in manifest), "must never include an actions field");
  assert.match(manifest["notes"] as string, /^AI-suggested, unverified/);
});

test("parseSuggestedManifest force-flags notes even if the model omits the disclaimer", () => {
  const reply = JSON.stringify({ id: "acme", label: "Acme", notes: "It uses OAuth2." });
  const manifest = parseSuggestedManifest(reply, "Acme");
  assert.match(manifest["notes"] as string, /^AI-suggested, unverified — review before use\. It uses OAuth2\.$/);
});

test("parseSuggestedManifest tolerates a fenced reply and falls back to the vendor name for a missing label", () => {
  const reply = "```json\n" + JSON.stringify({ id: "acme" }) + "\n```";
  const manifest = parseSuggestedManifest(reply, "Acme Corp");
  assert.equal(manifest["label"], "Acme Corp");
  assert.equal(manifest["notes"], "AI-suggested, unverified — review before use.");
});

test("parseSuggestedManifest throws SuggestParseError on unparseable content", () => {
  assert.throws(() => parseSuggestedManifest("not json at all", "Acme"), SuggestParseError);
});
