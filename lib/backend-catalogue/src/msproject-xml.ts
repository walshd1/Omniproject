/**
 * Microsoft Project XML (MSPDI) → import rows. The desktop .mpp format has no API; Project's
 * lossless interchange is the MSPDI XML schema (mspdi_pj12/15.xsd), and every third-party tool
 * reads it. This parser flattens `<Tasks><Task>` (joined with `<Resources>`/`<Assignments>` by
 * UID) into the `{ headers, rows }` shape `POST /api/import/preview` takes — everything
 * downstream (column suggestion → confirm → commit → per-row ruleset) is already format-blind.
 *
 * Deliberately dependency-free and MSPDI-specific, not a general XML parser:
 *  - Machine-generated MSPDI carries no attributes on the elements read here and a FIXED element
 *    sequence (the XSD is a `sequence`), so anchored tag extraction is sound.
 *  - Nested containers that shadow scalar names (`<Baseline>` holds its own Start/Finish/Duration;
 *    `<ExtendedAttribute>`, `<PredecessorLink>`, `<TimephasedData>`) are STRIPPED from a task block
 *    before scalars are read, so a task's own fields can never be confused with a baseline's.
 *  - Character data is entity-unescaped (&amp; &lt; &gt; &quot; &apos; + numeric references).
 *
 * Summary rows (the outline parents, `<Summary>1</Summary>`) and the project row (UID 0) are
 * skipped by default — they are structure, not work — but the parent CHAIN is preserved: each
 * row's `parentTask` is the nearest ancestor task's name derived from `OutlineLevel` order.
 */

export interface MspdiTaskRow {
  uid: string;
  name: string;
  startDate: string | null;
  dueDate: string | null;
  /** Duration as decimal hours (from PT#H#M#S). */
  estimateHours: number | null;
  percentWorkComplete: number | null;
  wbsCode: string | null;
  milestone: boolean;
  parentTask: string | null;
  /** "UID:type(+lag)" per predecessor, ";"-joined — carried as text for the dependsOn mapper. */
  dependsOn: string | null;
  assignee: string | null;
  description: string | null;
}

export interface MspdiParseResult {
  projectName: string | null;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  /** Count of skipped structural rows (summaries + the UID-0 project row). */
  skippedSummaries: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(v: string): string {
  return v.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, ent: string) => {
    if (ent.startsWith("#x") || ent.startsWith("#X")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return ENTITIES[ent] ?? m;
  });
}

/** First direct occurrence of `<tag>…</tag>` in a (container-stripped) block, unescaped. */
function scalar(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? unescapeXml(m[1]!.trim()) : null;
}

/** Every `<tag>…</tag>` block (used for the repeating containers). */
function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]!);
  return out;
}

/** PT8H30M0S → 8.5 (hours). Returns null for absent/unparseable durations. */
export function mspdiDurationToHours(v: string | null): number | null {
  if (!v) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600;
  return Math.round(h * 100) / 100;
}

const LINK_TYPE: Record<string, string> = { "0": "FF", "1": "FS", "2": "SF", "3": "SS" };

/** Containers inside <Task> whose children shadow the task's own scalar names. */
const TASK_CONTAINERS = ["PredecessorLink", "Baseline", "ExtendedAttribute", "TimephasedData", "OutlineCode"];

export function parseMspdi(xml: string): MspdiParseResult {
  const projectName = scalar(xml, "Title") ?? scalar(xml, "Name");

  // Resource UID → name, for resolving assignment rows to a display assignee.
  const resourceName = new Map<string, string>();
  for (const r of blocks(blocks(xml, "Resources")[0] ?? "", "Resource")) {
    const uid = scalar(r, "UID");
    const name = scalar(r, "Name");
    if (uid && name) resourceName.set(uid, name);
  }

  // Task UID → assignee names (an MSPDI task can carry several assignments).
  const assignees = new Map<string, string[]>();
  for (const a of blocks(blocks(xml, "Assignments")[0] ?? "", "Assignment")) {
    const taskUid = scalar(a, "TaskUID");
    const resUid = scalar(a, "ResourceUID");
    const name = resUid ? resourceName.get(resUid) : undefined;
    if (taskUid && name) assignees.set(taskUid, [...(assignees.get(taskUid) ?? []), name]);
  }

  const taskBlocks = blocks(blocks(xml, "Tasks")[0] ?? "", "Task");
  const rows: MspdiTaskRow[] = [];
  let skippedSummaries = 0;
  // Outline-level parent chain: parents[level] = the last task NAME seen at that level.
  const parents: string[] = [];

  for (const raw of taskBlocks) {
    // Predecessors first (they live in a container we're about to strip).
    const deps = blocks(raw, "PredecessorLink")
      .map((l) => {
        const uid = scalar(l, "PredecessorUID");
        if (!uid) return null;
        const type = LINK_TYPE[scalar(l, "Type") ?? "1"] ?? "FS";
        const lag = scalar(l, "LinkLag");
        return `${uid}:${type}${lag && lag !== "0" ? `+${lag}` : ""}`;
      })
      .filter((d): d is string => !!d);

    let block = raw;
    for (const c of TASK_CONTAINERS) block = block.replace(new RegExp(`<${c}>[\\s\\S]*?</${c}>`, "g"), "");

    const uid = scalar(block, "UID");
    const name = scalar(block, "Name");
    if (!uid || !name) continue; // a malformed/empty task row carries nothing importable

    const level = Number(scalar(block, "OutlineLevel") ?? "1");
    const isSummary = scalar(block, "Summary") === "1" || uid === "0";
    const parent = level > 1 ? (parents[level - 1] ?? null) : null;
    parents[level] = name; // this task is the parent candidate for the next deeper level
    parents.length = level + 1; // leaving a subtree forgets its deeper parents

    if (isSummary) {
      skippedSummaries++;
      continue;
    }

    rows.push({
      uid,
      name,
      startDate: scalar(block, "Start"),
      dueDate: scalar(block, "Finish"),
      estimateHours: mspdiDurationToHours(scalar(block, "Duration")),
      percentWorkComplete: scalar(block, "PercentComplete") != null ? Number(scalar(block, "PercentComplete")) : null,
      wbsCode: scalar(block, "WBS"),
      milestone: scalar(block, "Milestone") === "1",
      parentTask: parent,
      dependsOn: deps.length ? deps.join(";") : null,
      assignee: assignees.get(uid)?.join(", ") ?? null,
      description: scalar(block, "Notes"),
    });
  }

  // Import-API shape: headers use the MSPDI words (the column-mapper's synonym table takes them
  // from there to the canonical fields), rows keyed identically.
  const headers = ["UID", "Name", "Start", "Finish", "Duration", "PercentComplete", "WBS", "Milestone", "Parent", "Predecessors", "Resource", "Notes"];
  return {
    projectName,
    headers,
    skippedSummaries,
    rows: rows.map((r) => ({
      UID: r.uid,
      Name: r.name,
      Start: r.startDate,
      Finish: r.dueDate,
      Duration: r.estimateHours,
      PercentComplete: r.percentWorkComplete,
      WBS: r.wbsCode,
      Milestone: r.milestone,
      Parent: r.parentTask,
      Predecessors: r.dependsOn,
      Resource: r.assignee,
      Notes: r.description,
    })),
  };
}
