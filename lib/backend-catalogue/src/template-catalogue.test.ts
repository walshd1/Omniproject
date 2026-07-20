import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_TEMPLATES, getProjectTemplate, projectTemplateCatalogue, projectTemplatesForMethodology } from "./template-catalogue";

test("shipped templates are well-formed: unique ids, seed issues have titles", () => {
  const ids = new Set<string>();
  for (const t of PROJECT_TEMPLATES) {
    assert.ok(t.id && t.label);
    assert.ok(!ids.has(t.id), `dup ${t.id}`); ids.add(t.id);
    for (const i of t.seedIssues ?? []) assert.ok(i.title, `seed issue needs a title in ${t.id}`);
  }
});

test("getProjectTemplate / catalogue / methodology filter", () => {
  assert.equal(getProjectTemplate("scrum-starter")?.methodology, "scrum");
  assert.equal(getProjectTemplate("nope"), undefined);
  assert.equal(projectTemplateCatalogue().length, PROJECT_TEMPLATES.length);
  assert.ok(projectTemplatesForMethodology("scrum").some((t) => t.id === "scrum-starter"));
  assert.ok(!projectTemplatesForMethodology("scrum").some((t) => t.id === "prince2-starter"));
});
