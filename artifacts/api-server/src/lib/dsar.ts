import { scimEnabled, listUsers, type ScimUser } from "./scim";
import { recentProvenance } from "./provenance";
import { userSessionsRevokedAt } from "./key-registry";
import { auditAnchor, auditLogSubjectRefs } from "./audit-chain";
import { configuredBrokerUrls } from "./broker-url";
import { retentionDaysNow } from "./history-retention";

/**
 * DSAR (data-subject access request) evidence report — the automated, honest answer to
 * "what do you hold / process for subject X".
 *
 * OmniProject is zero-at-rest, so the truthful answer is mostly: we hold NO personal data at rest
 * — your connected systems of record do. This assembles, from the live gateway state only, an
 * auditor-ready picture of: (a) what the gateway transiently processes and explicitly does NOT
 * retain, (b) the small amount it DOES hold that references the subject (a SCIM directory record
 * if SCIM is on; a session-revocation mark; the content-free provenance ring), and (c) where the
 * subject's actual data lives (the connected backends — pointers, never copies) plus the audit
 * anchor so the external SIEM slice for the subject can be verified.
 *
 * It never copies backend/personal data into the gateway; it reports references and locations.
 */

export interface DsarSubject { sub?: string | undefined; email?: string | undefined }

export interface DsarReport {
  subject: DsarSubject;
  generatedAt: string;
  /** Plain statements of what the gateway does NOT keep (zero-at-rest posture). */
  notRetained: string[];
  /** What the gateway DOES hold that references this subject, if anything. */
  held: {
    scimDirectoryRecord: ScimUser | null;
    sessionsRevokedAt: string | null;
    /** Content-free provenance fingerprints in the in-memory ring that name this subject. */
    provenanceReferences: { seq: number; hop: string; action: string; at: string }[];
    provenanceNote: string;
  };
  /** Where the subject's real data lives — pointers to the systems of record. */
  systemsOfRecord: { note: string; brokerEndpoints: string[] };
  /** Audit evidence: the tamper-evident chain anchor + how many retained events name the subject. */
  auditEvidence: {
    note: string;
    anchor: ReturnType<typeof auditAnchor>;
    /** Retained evidence events naming this subject (content-free count), and the disposal window. */
    retainedReferences: number;
    retentionDays: number | null;
  };
}

const matches = (value: string | null | undefined, subject: DsarSubject): boolean => {
  if (!value) return false;
  const v = value.toLowerCase();
  return (!!subject.sub && v === subject.sub.toLowerCase()) || (!!subject.email && v === subject.email.toLowerCase());
};

/** Origin-only broker endpoints (a secret webhook path is never surfaced). */
function brokerOrigins(): string[] {
  return [...new Set(configuredBrokerUrls().map((u) => { try { return new URL(u).origin; } catch { return u; } }))];
}

/** Build the DSAR evidence report for a subject from live gateway state only. */
export function buildDsarReport(subject: DsarSubject, now: number): DsarReport {
  const scimRecord = scimEnabled()
    ? listUsers().find((u) =>
        matches(u.userName, subject) ||
        matches(u.externalId, subject) ||
        (u.emails ?? []).some((e) => matches(e.value, subject)),
      ) ?? null
    : null;

  const revokedAt = subject.sub ? userSessionsRevokedAt(subject.sub) : 0;

  const provenanceReferences = recentProvenance()
    .filter((e) => matches(e.actor, subject))
    .map((e) => ({ seq: e.seq, hop: e.hop, action: e.action, at: e.tWall }));

  return {
    subject,
    generatedAt: new Date(now).toISOString(),
    notRetained: [
      "Project, issue and portfolio data — never stored by the gateway; held only by the connected backends (systems of record).",
      "Session identity claims (sub, email, name, roles) — read from the IdP token per request, held only in the signed, self-expiring session cookie on the subject's device; never persisted server-side.",
      "Role derivation — computed per request from IdP claims + the role map; not stored against the subject.",
      "Prompt/AI content and dictation audio — not retained (dictation is local-first).",
    ],
    held: {
      scimDirectoryRecord: scimRecord,
      sessionsRevokedAt: revokedAt > 0 ? new Date(revokedAt).toISOString() : null,
      provenanceReferences,
      provenanceNote:
        "Content-free, keyed-MAC fingerprints of recent broker calls (action + actor + ordering only — never request/response content). A bounded in-memory ring (lost on restart), not durable storage.",
    },
    systemsOfRecord: {
      note:
        "The subject's actual data lives in the connected backend(s) reached via the broker. Satisfy access/portability/erasure THERE; the gateway holds no copy. Endpoints (origins only) below.",
      brokerEndpoints: brokerOrigins(),
    },
    auditEvidence: (() => {
      const refs = auditLogSubjectRefs((actor) => matches(actor?.sub, subject) || matches(actor?.email, subject));
      const retentionDays = retentionDaysNow();
      return {
        note:
          "Audit events are emitted to your external SIEM/stdout sink AND retained in the gateway's sealed, tamper-evident evidence log (bounded by the history-retention window; carried only in an encrypted backup). Audit records are kept under a legal-obligation / legitimate-interest basis for security + integrity: they are EXEMPT from erasure, but disposed once past the retention window (unless under a legal hold). The chain anchor below verifies the slice is intact (see /api/security/audit/verify).",
        anchor: auditAnchor(),
        retainedReferences: refs.retained,
        retentionDays: typeof retentionDays === "number" && retentionDays > 0 ? retentionDays : null,
      };
    })(),
  };
}

/** A human-readable summary of the report (for the operator handling the request). */
export function dsarSummaryText(r: DsarReport): string {
  const who = r.subject.sub || r.subject.email || "(unspecified subject)";
  const lines = [
    `DSAR evidence — ${who} — generated ${r.generatedAt}`,
    "",
    "HELD BY THE GATEWAY:",
    `• SCIM directory record: ${r.held.scimDirectoryRecord ? `yes (id ${r.held.scimDirectoryRecord.id}) — delete via SCIM to erase` : "none"}`,
    `• Session revocation mark: ${r.held.sessionsRevokedAt ?? "none"}`,
    `• Provenance references (in-memory, content-free): ${r.held.provenanceReferences.length}`,
    "",
    "NOT RETAINED:",
    ...r.notRetained.map((s) => `• ${s}`),
    "",
    `SYSTEMS OF RECORD (where the data actually lives): ${r.systemsOfRecord.brokerEndpoints.join(", ") || "(none configured)"}`,
    `AUDIT EVIDENCE: SIEM + sealed local log (chain tip seq ${r.auditEvidence.anchor.seq}); ${r.auditEvidence.retainedReferences} retained event(s) name this subject; retention ${r.auditEvidence.retentionDays === null ? "unbounded" : `${r.auditEvidence.retentionDays} day(s)`} (audit is erasure-exempt).`,
  ];
  return lines.join("\n");
}
