import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeText, foldLine, formatDateUtc, buildIcs, type IcsEvent } from "./ical";

const NOW = new Date("2026-07-12T09:30:00Z");

test("escapeText escapes backslash, semicolon, comma and newlines per RFC 5545", () => {
  assert.equal(escapeText("a,b;c\\d"), "a\\,b\\;c\\\\d");
  assert.equal(escapeText("line1\nline2"), "line1\\nline2");
});

test("foldLine wraps content lines longer than 75 octets with a leading space", () => {
  const short = "SUMMARY:hello";
  assert.equal(foldLine(short), short);
  const long = "SUMMARY:" + "x".repeat(100);
  const folded = foldLine(long);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1, "long line is folded");
  assert.ok(lines[0]!.length <= 75);
  assert.ok(lines.slice(1).every((l) => l.startsWith(" ")), "continuation lines are space-prefixed");
});

test("buildIcs emits a VCALENDAR with all-day VEVENTs (DTEND is the exclusive next day)", () => {
  const events: IcsEvent[] = [
    { uid: "task-1@omniproject", summary: "Ship it", start: "2026-07-20", allDay: true, description: "Status: next" },
  ];
  const ics = buildIcs({ name: "My tasks", events, now: NOW });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.includes("VERSION:2.0"));
  assert.ok(ics.includes("X-WR-CALNAME:My tasks"));
  assert.ok(ics.includes("DTSTAMP:20260712T093000Z"));
  assert.ok(ics.includes("BEGIN:VEVENT"));
  assert.ok(ics.includes("UID:task-1@omniproject"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20260720"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20260721"), "DTEND is the exclusive next day");
  assert.ok(ics.includes("SUMMARY:Ship it"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("\r\n"), "CRLF line endings");
});

test("buildIcs skips an event whose date can't be parsed rather than emitting an invalid VEVENT", () => {
  const ics = buildIcs({ name: "x", events: [{ uid: "u", summary: "s", start: "not-a-date", allDay: true }], now: NOW });
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});

test("formatDateUtc is UTC and zero-padded", () => {
  assert.equal(formatDateUtc(new Date("2026-01-05T00:00:00Z")), "20260105");
});
