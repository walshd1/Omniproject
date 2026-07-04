import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isEmailConfigured, sendEmail, type Mailer } from "./email";

const ENV = ["SMTP_URL", "EMAIL_FROM"];
afterEach(() => { for (const k of ENV) delete process.env[k]; });

test("isEmailConfigured is false unset, true once SMTP_URL is set", () => {
  assert.equal(isEmailConfigured({}), false);
  assert.equal(isEmailConfigured({ SMTP_URL: "" }), false);
  assert.equal(isEmailConfigured({ SMTP_URL: "smtps://user:pass@smtp.example.com" }), true);
});

test("sendEmail returns false without throwing when unconfigured and no mailer is injected", async () => {
  delete process.env["SMTP_URL"];
  const sent = await sendEmail({ to: "a@b.co", subject: "hi", text: "body" });
  assert.equal(sent, false);
});

test("sendEmail uses an injected mailer regardless of SMTP_URL, passing the from/to/subject/text through", async () => {
  const calls: unknown[] = [];
  const fake: Mailer = { sendMail: async (msg) => { calls.push(msg); return { messageId: "1" }; } };
  const sent = await sendEmail({ to: "a@b.co", subject: "Sign in", text: "click here" }, fake);
  assert.equal(sent, true);
  assert.deepEqual(calls, [{ from: "OmniProject <no-reply@localhost>", to: "a@b.co", subject: "Sign in", text: "click here" }]);
});

test("sendEmail honours EMAIL_FROM when set", async () => {
  process.env["EMAIL_FROM"] = "Custom <custom@example.com>";
  const calls: Array<{ from: string }> = [];
  const fake: Mailer = { sendMail: async (msg) => { calls.push(msg); return {}; } };
  await sendEmail({ to: "a@b.co", subject: "s", text: "t" }, fake);
  assert.equal(calls[0]?.from, "Custom <custom@example.com>");
});

test("sendEmail returns false (never throws) when the transport rejects", async () => {
  const failing: Mailer = { sendMail: async () => { throw new Error("connection refused"); } };
  const sent = await sendEmail({ to: "a@b.co", subject: "s", text: "t" }, failing);
  assert.equal(sent, false);
});
