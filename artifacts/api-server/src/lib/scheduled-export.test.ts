import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runScheduledExport } from "./scheduled-export";
import { updateSettings } from "./settings";
import type { Broker } from "../broker/types";
import type { Mailer, MailAttachment } from "./email";

/**
 * Scheduled export: reads a dataset through the broker under an autonomous principal, renders it, and
 * emails it as an attachment to the configured recipients — a no-op unless recipients are set.
 */
afterEach(() => {
  updateSettings({ digestDelivery: { emailRecipients: [] } });
  delete process.env["SCHEDULED_EXPORT_FORMAT"];
  delete process.env["SCHEDULED_EXPORT_DATASET"];
});

const broker = {
  kind: "demo",
  listProjects: async () => [{ id: "p1", name: "Alpha", identifier: "AL" }],
  listIssues: async () => [],
  listActivity: async () => [],
} as unknown as Broker;

test("runScheduledExport renders the dataset and emails it as an attachment", async () => {
  updateSettings({ digestDelivery: { emailRecipients: ["ops@x.io"] } });
  const sent: { to: string; subject: string; attachments: MailAttachment[] | undefined }[] = [];
  const mailer: Mailer = { sendMail: async (m) => { sent.push({ to: m.to, subject: m.subject, attachments: m.attachments }); } };

  const r = await runScheduledExport({ broker, now: 1_700_000_000_000, format: "csv", dataset: "projects", mailer });
  assert.equal(r.rows, 1);
  assert.equal(r.emailed, 1);
  assert.equal(sent.length, 1);
  const att = sent[0]!.attachments![0]!;
  assert.match(att.filename, /^omniproject-projects-.*\.csv$/);
  assert.match(String(att.content), /Alpha/); // the project row made it into the CSV attachment
});

test("runScheduledExport is a no-op delivery when no recipients are configured", async () => {
  const sent: unknown[] = [];
  const mailer: Mailer = { sendMail: async (m) => { sent.push(m); } };
  const r = await runScheduledExport({ broker, now: 1, format: "csv", dataset: "projects", mailer });
  assert.equal(r.rows, 1); // still rendered
  assert.equal(r.emailed, 0); // but nothing emailed
  assert.equal(sent.length, 0);
});

test("runScheduledExport honours the configured format (pdf → a Buffer attachment)", async () => {
  updateSettings({ digestDelivery: { emailRecipients: ["ops@x.io"] } });
  const sent: { attachments: MailAttachment[] | undefined }[] = [];
  const mailer: Mailer = { sendMail: async (m) => { sent.push({ attachments: m.attachments }); } };

  const r = await runScheduledExport({ broker, now: 1, format: "pdf", dataset: "projects", mailer });
  assert.equal(r.format, "pdf");
  const att = sent[0]!.attachments![0]!;
  assert.match(att.filename, /\.pdf$/);
  assert.ok(Buffer.isBuffer(att.content)); // pdf renders to a Buffer
});
