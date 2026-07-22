import { test } from "node:test";
import assert from "node:assert/strict";
import { toOpenAiMessages, toAnthropicMessages, toOllamaMessages, type ChatMessage } from "../lib/ai";

/**
 * The multimodal message mappers (roadmap X.2 slice 4). Adding an optional `images` field to ChatMessage is
 * ADDITIVE: with no image, each provider body is byte-identical to before; with an image, each maps to that
 * provider's native vision shape.
 */

const TEXT: ChatMessage[] = [{ role: "system", content: "sys" }, { role: "user", content: "hi" }];
const WITH_IMAGE: ChatMessage[] = [
  { role: "user", content: "match this", images: [{ mime: "image/png", dataBase64: "AAAA" }] },
];

test("no image → plain {role, content} for every provider (backward compatible)", () => {
  assert.deepEqual(toOpenAiMessages(TEXT), [{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
  assert.deepEqual(toAnthropicMessages(TEXT), [{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
  assert.deepEqual(toOllamaMessages(TEXT), [{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
});

test("openai maps an image to a data-URI image_url content part", () => {
  const [msg] = toOpenAiMessages(WITH_IMAGE) as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  assert.equal(msg!.role, "user");
  assert.deepEqual(msg!.content[0], { type: "text", text: "match this" });
  assert.deepEqual(msg!.content[1], { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
});

test("anthropic maps an image to a base64 image block", () => {
  const [msg] = toAnthropicMessages(WITH_IMAGE) as Array<{ content: Array<Record<string, unknown>> }>;
  assert.deepEqual(msg!.content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
});

test("ollama rides images as a sibling base64 array", () => {
  const [msg] = toOllamaMessages(WITH_IMAGE) as Array<{ content: string; images: string[] }>;
  assert.equal(msg!.content, "match this");
  assert.deepEqual(msg!.images, ["AAAA"]);
});
