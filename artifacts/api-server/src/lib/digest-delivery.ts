import { sendEmail, isEmailConfigured, type Mailer } from "./email";
import { getSettings } from "./settings";
import { logger } from "./logger";

/**
 * Optional ABOVE-THE-SEAM email delivery of the scheduled digests (proactive + exec).
 *
 * The digests already dispatch over the notify bus, whose delivery to email/Slack/Teams is routed
 * BELOW the seam by the broker workflow. This adds a direct SMTP channel for operators who don't route
 * notifications through their broker — a delivery channel (like an egress), NOT persistence, so it
 * doesn't touch the zero-at-rest rule. Stateless: the recipient list is plain config (settings /
 * `DIGEST_EMAIL_RECIPIENTS`), nothing is stored.
 *
 * Best-effort by construction (mirrors lib/email): never throws, and a NO-OP unless SMTP is configured
 * AND at least one recipient is set — so leaving it unconfigured changes nothing.
 */

export interface DeliverableDigest {
  title: string;
  body: string;
}

/** Email a built digest to the configured recipients, in addition to the notify-bus dispatch. Returns
 *  how many recipients were successfully emailed (0 when unconfigured). `recipients`/`mailer` are
 *  injectable for tests; by default recipients come from settings. */
export async function deliverDigestEmail(
  digest: DeliverableDigest,
  opts: { recipients?: string[]; mailer?: Mailer } = {},
): Promise<{ emailed: number }> {
  const recipients = (opts.recipients ?? getSettings().digestDelivery.emailRecipients)
    .map((r) => r.trim())
    .filter(Boolean);
  // No SMTP (and no injected mailer) or no recipients ⇒ nothing to do.
  if ((!opts.mailer && !isEmailConfigured()) || recipients.length === 0) return { emailed: 0 };

  let emailed = 0;
  for (const to of recipients) {
    const ok = await sendEmail({ to, subject: digest.title, text: digest.body }, opts.mailer);
    if (ok) emailed += 1;
  }
  if (emailed > 0) logger.info({ emailed, recipients: recipients.length }, "digest: emailed to configured recipients");
  return { emailed };
}
