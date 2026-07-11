import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { deliverDigestEmail } from "./digest-delivery";
import { updateSettings } from "./settings";
import type { Mailer } from "./email";

/**
 * Optional above-seam digest email delivery: a no-op unless SMTP (or an injected mailer) AND
 * recipients are both present; otherwise it emails each configured recipient the digest.
 */
const sent: { to: string; subject: string; text: string }[] = [];
const fakeMailer: Mailer = { sendMail: async (m) => { sent.push({ to: m.to, subject: m.subject, text: m.text }); } };

afterEach(() => {
  sent.length = 0;
  updateSettings({ digestDelivery: { emailRecipients: [] } });
});

test("no recipients → no-op (nothing sent)", async () => {
  const r = await deliverDigestEmail({ title: "t", body: "b" }, { mailer: fakeMailer });
  assert.equal(r.emailed, 0);
  assert.equal(sent.length, 0);
});

test("no mailer and no SMTP configured → no-op even with recipients", async () => {
  // SMTP_URL is unset in the test process, so isEmailConfigured() is false and there's no injected mailer.
  const r = await deliverDigestEmail({ title: "t", body: "b" }, { recipients: ["a@x.io"] });
  assert.equal(r.emailed, 0);
  assert.equal(sent.length, 0);
});

test("recipients passed + injected mailer → emails each with the digest title/body", async () => {
  const r = await deliverDigestEmail(
    { title: "What needs you", body: "3 at risk" },
    { recipients: ["a@x.io", "b@x.io"], mailer: fakeMailer },
  );
  assert.equal(r.emailed, 2);
  assert.deepEqual(sent.map((m) => m.to), ["a@x.io", "b@x.io"]);
  assert.equal(sent[0]!.subject, "What needs you");
  assert.equal(sent[0]!.text, "3 at risk");
});

test("recipients default to the settings list when not passed explicitly", async () => {
  updateSettings({ digestDelivery: { emailRecipients: ["ops@x.io"] } });
  const r = await deliverDigestEmail({ title: "t", body: "b" }, { mailer: fakeMailer });
  assert.equal(r.emailed, 1);
  assert.equal(sent[0]!.to, "ops@x.io");
});

test("blank/whitespace recipients are ignored", async () => {
  const r = await deliverDigestEmail({ title: "t", body: "b" }, { recipients: ["  ", "real@x.io", ""], mailer: fakeMailer });
  assert.equal(r.emailed, 1);
  assert.deepEqual(sent.map((m) => m.to), ["real@x.io"]);
});
