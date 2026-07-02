import { describe, it, expect } from "vitest";
import {
  parseCsvText,
  featureGatingRowsToCsv,
  parseFeatureGatingCsv,
  buildFeatureGatingExportRows,
  diffGatingRow,
  type ScopeGatingRow,
} from "./feature-gating-csv";

const VALID_IDS = new Set(["grid", "presence", "report:evm", "methodology:prince2"]);
const PROGRAMMES = new Set(["prog-1", "prog-2"]);
const PROJECTS = new Set(["p1", "p2"]);

function opts(overrides: Partial<{ validFeatureIds: Set<string>; knownProgrammeIds: Set<string>; knownProjectIds: Set<string> }> = {}) {
  return {
    validFeatureIds: overrides.validFeatureIds ?? VALID_IDS,
    knownProgrammeIds: overrides.knownProgrammeIds ?? PROGRAMMES,
    knownProjectIds: overrides.knownProjectIds ?? PROJECTS,
  };
}

describe("parseCsvText", () => {
  it("splits plain comma-separated rows", () => {
    expect(parseCsvText("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quoted cells with embedded commas, quotes and newlines", () => {
    const text = 'a,b\n"hello, world","she said ""hi""\nnext line"';
    expect(parseCsvText(text)).toEqual([["a", "b"], ["hello, world", 'she said "hi"\nnext line']]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsvText("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsvText("﻿a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("featureGatingRowsToCsv / parseFeatureGatingCsv round trip", () => {
  const rows: ScopeGatingRow[] = [
    { scopeType: "programme", scopeId: "prog-1", scopeName: "Transformation, Phase 1", disabled: ["grid"], required: [], forbidden: [] },
    { scopeType: "project", scopeId: "p1", scopeName: 'The "Alpha" project', disabled: [], required: ["presence"], forbidden: ["report:evm"] },
  ];

  it("serialises and parses back the same rows (including commas/quotes in scopeName)", () => {
    const csv = featureGatingRowsToCsv(rows);
    expect(csv.startsWith("﻿")).toBe(true);
    const { rows: parsed, errors, warnings } = parseFeatureGatingCsv(csv, opts());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ scopeType: "programme", scopeId: "prog-1", disabled: ["grid"], required: [], forbidden: [] });
    expect(parsed[1]).toMatchObject({ scopeType: "project", scopeId: "p1", disabled: [], required: ["presence"], forbidden: ["report:evm"] });
  });

  it("round-trips an id containing a pipe-adjacent but otherwise plain list with multiple ids", () => {
    const multi: ScopeGatingRow[] = [{ scopeType: "project", scopeId: "p2", scopeName: "Beta", disabled: ["grid", "presence"], required: [], forbidden: [] }];
    const { rows: parsed } = parseFeatureGatingCsv(featureGatingRowsToCsv(multi), opts());
    expect(parsed[0]?.disabled).toEqual(["grid", "presence"]);
  });
});

describe("parseFeatureGatingCsv validation", () => {
  const header = "scopeType,scopeId,scopeName,disabled,required,forbidden";

  it("rejects a missing header column", () => {
    const { errors } = parseFeatureGatingCsv("scopeType,scopeId\nprogramme,prog-1", opts());
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/Missing column/);
  });

  it("rejects a bad scopeType but keeps parsing other rows", () => {
    const csv = `${header}\nbogus,prog-1,,,,\nprogramme,prog-2,,,,`;
    const { rows, errors } = parseFeatureGatingCsv(csv, opts());
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/scopeType/);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scopeId).toBe("prog-2");
  });

  it("rejects a row with a malformed (unknown) feature id, but keeps other rows", () => {
    const csv = `${header}\nprogramme,prog-1,,not-a-real-id,,\nprogramme,prog-2,,grid,,`;
    const { rows, errors } = parseFeatureGatingCsv(csv, opts());
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/not-a-real-id/);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scopeId).toBe("prog-2");
  });

  it("rejects a row that both requires and forbids the same id", () => {
    const csv = `${header}\nprogramme,prog-1,,,grid,grid`;
    const { rows, errors } = parseFeatureGatingCsv(csv, opts());
    expect(rows).toHaveLength(0);
    expect(errors[0]?.message).toMatch(/both required and forbidden/);
  });

  it("warns (not fatal) on an unrecognised scope id", () => {
    const csv = `${header}\nprogramme,ghost-prog,,,,`;
    const { rows, errors, warnings } = parseFeatureGatingCsv(csv, opts());
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/ghost-prog/);
  });

  it("rejects a blank scopeId", () => {
    const csv = `${header}\nprogramme,,,,,`;
    const { errors } = parseFeatureGatingCsv(csv, opts());
    expect(errors[0]?.message).toMatch(/scopeId is required/);
  });

  it("rejects a prototype-pollution-shaped scopeId", () => {
    const csv = `${header}\nprogramme,__proto__,,,,`;
    const { errors, rows } = parseFeatureGatingCsv(csv, opts());
    expect(rows).toHaveLength(0);
    expect(errors[0]?.message).toMatch(/scopeId is required/);
  });

  it("splits pipe-separated ids and trims whitespace", () => {
    const csv = `${header}\nproject,p1,,"grid | presence",,`;
    const { rows } = parseFeatureGatingCsv(csv, opts());
    expect(rows[0]?.disabled).toEqual(["grid", "presence"]);
  });
});

describe("buildFeatureGatingExportRows", () => {
  it("emits one row per programme/project, filling blanks where no override exists", () => {
    const rows = buildFeatureGatingExportRows(
      [{ id: "prog-1", name: "Transformation" }],
      [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }],
      { "prog-1": { disabled: ["grid"], required: [], forbidden: [] } },
      { p1: { disabled: [], required: ["presence"], forbidden: [] } },
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.scopeId === "prog-1")?.disabled).toEqual(["grid"]);
    expect(rows.find((r) => r.scopeId === "p2")).toMatchObject({ disabled: [], required: [], forbidden: [] });
  });
});

describe("diffGatingRow", () => {
  const base = { line: 2, scopeType: "project" as const, scopeId: "p1", scopeName: "Alpha" };

  it("is 'new' when no current config exists", () => {
    const row = { ...base, disabled: ["grid"], required: [], forbidden: [] };
    const diff = diffGatingRow(row, undefined);
    expect(diff.status).toBe("new");
    expect(diff.disabled).toEqual({ added: ["grid"], removed: [] });
  });

  it("is 'unchanged' when the sets match regardless of order", () => {
    const row = { ...base, disabled: ["grid", "presence"], required: [], forbidden: [] };
    const diff = diffGatingRow(row, { disabled: ["presence", "grid"], required: [], forbidden: [] });
    expect(diff.status).toBe("unchanged");
  });

  it("is 'changed' and reports per-dimension added/removed ids", () => {
    const row = { ...base, disabled: ["presence"], required: ["grid"], forbidden: [] };
    const diff = diffGatingRow(row, { disabled: ["grid"], required: [], forbidden: [] });
    expect(diff.status).toBe("changed");
    expect(diff.disabled).toEqual({ added: ["presence"], removed: ["grid"] });
    expect(diff.required).toEqual({ added: ["grid"], removed: [] });
    expect(diff.forbidden).toEqual({ added: [], removed: [] });
  });
});

describe("CSV injection guard", () => {
  it("neutralises a formula-triggering scopeName on export", () => {
    const rows: ScopeGatingRow[] = [{ scopeType: "project", scopeId: "p1", scopeName: "=cmd|' /C calc'!A1", disabled: [], required: [], forbidden: [] }];
    const csv = featureGatingRowsToCsv(rows);
    expect(csv).toContain("'=cmd");
  });
});
