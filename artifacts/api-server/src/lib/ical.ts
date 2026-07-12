/**
 * Minimal RFC 5545 (iCalendar) serialiser — pure + deterministic, so any dated OmniProject data can
 * be rendered as a `.ics` a user imports into Google/Outlook/Apple Calendar. Read-only projection:
 * it emits VEVENTs, it never parses or ingests a calendar. Text is escaped and long lines are folded
 * per the spec so real calendar clients accept the output.
 */

export interface IcsEvent {
  /** Globally-unique, stable id (so re-import updates rather than duplicates). */
  uid: string;
  summary: string;
  /** ISO date (`YYYY-MM-DD`, all-day) or ISO datetime; interpreted per `allDay`. */
  start: string;
  /** All-day (a due date) → `VALUE=DATE`; else a timed UTC event. */
  allDay: boolean;
  description?: string | undefined;
  url?: string | undefined;
  /** An absolute display reminder (VALARM) — `at` is an ISO datetime; ignored if unparseable. */
  alarm?: { at: string; description?: string | undefined } | undefined;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/** Fold a content line to ≤75 octets, continuation lines prefixed with a space (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** A `Date` → `YYYYMMDD` in UTC (all-day form). */
export function formatDateUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** A `Date` → `YYYYMMDDTHHMMSSZ` in UTC (timed form). */
export function formatDateTimeUtc(d: Date): string {
  return `${formatDateUtc(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Parse a `YYYY-MM-DD` all-day date as UTC midnight (TZ-stable). */
function parseDateOnly(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isFinite(d.getTime()) ? d : null;
}

function renderEvent(ev: IcsEvent, dtstamp: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${escapeText(ev.uid)}`, `DTSTAMP:${dtstamp}`];
  if (ev.allDay) {
    const d = parseDateOnly(ev.start);
    if (!d) return []; // undatable → skip rather than emit an invalid VEVENT
    const end = new Date(d.getTime() + 24 * 60 * 60 * 1000); // DTEND is exclusive (next day)
    lines.push(`DTSTART;VALUE=DATE:${formatDateUtc(d)}`, `DTEND;VALUE=DATE:${formatDateUtc(end)}`);
  } else {
    const d = new Date(ev.start);
    if (!Number.isFinite(d.getTime())) return [];
    lines.push(`DTSTART:${formatDateTimeUtc(d)}`);
  }
  lines.push(`SUMMARY:${escapeText(ev.summary)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.url) lines.push(`URL:${escapeText(ev.url)}`);
  if (ev.alarm) {
    const at = new Date(ev.alarm.at);
    if (Number.isFinite(at.getTime())) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(ev.alarm.description || ev.summary)}`,
        `TRIGGER;VALUE=DATE-TIME:${formatDateTimeUtc(at)}`,
        "END:VALARM",
      );
    }
  }
  lines.push("END:VEVENT");
  return lines;
}

export interface BuildIcsInput {
  /** Calendar display name (X-WR-CALNAME). */
  name: string;
  events: IcsEvent[];
  /** Stamp for DTSTAMP (defaults to now; injectable for deterministic tests). */
  now?: Date;
}

/** Serialise a set of events into a complete VCALENDAR document (CRLF line endings, folded). */
export function buildIcs({ name, events, now = new Date() }: BuildIcsInput): string {
  const dtstamp = formatDateTimeUtc(now);
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OmniProject//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const ev of events) out.push(...renderEvent(ev, dtstamp));
  out.push("END:VCALENDAR");
  return out.map(foldLine).join("\r\n") + "\r\n";
}
