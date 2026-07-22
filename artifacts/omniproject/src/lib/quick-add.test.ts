import { describe, it, expect } from "vitest";
import { parseQuickAdd } from "./quick-add";

const TODAY = new Date(Date.UTC(2026, 1, 11)); // Wed 2026-02-11

describe("parseQuickAdd", () => {
  it("pulls tags, context, priority and a due date out of one line", () => {
    const r = parseQuickAdd("Buy milk #errands #home @shops !p1 ^tomorrow", TODAY);
    expect(r.title).toBe("Buy milk");
    expect(r.tags).toEqual(["errands", "home"]);
    expect(r.context).toBe("shops");
    expect(r.priority).toBe("urgent");
    expect(r.dueDate).toBe("2026-02-12");
  });

  it("accepts a multi-word date phrase after ^ and named priorities", () => {
    const r = parseQuickAdd("Call the accountant @calls !high ^next monday", TODAY);
    expect(r.title).toBe("Call the accountant");
    expect(r.context).toBe("calls");
    expect(r.priority).toBe("high");
    expect(r.dueDate).toBe("2026-02-16");
  });

  it("keeps unknown priorities and unparseable dates as literal title text", () => {
    const r = parseQuickAdd("Review !later notes ^someday", TODAY);
    expect(r.title).toBe("Review !later notes ^someday");
    expect(r.priority).toBeNull();
    expect(r.dueDate).toBeNull();
  });

  it("last @context wins; a bare sigil stays literal", () => {
    const r = parseQuickAdd("Plan @home @office thing #", TODAY);
    expect(r.context).toBe("office");
    expect(r.title).toBe("Plan thing #");
  });

  it("returns an empty-ish result for a blank line, and a plain title with no sigils", () => {
    expect(parseQuickAdd("", TODAY)).toEqual({ title: "", tags: [], context: null, priority: null, dueDate: null });
    const r = parseQuickAdd("Just a plain task", TODAY);
    expect(r.title).toBe("Just a plain task");
    expect(r.tags).toEqual([]);
  });
});
