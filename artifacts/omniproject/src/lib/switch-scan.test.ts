import { describe, it, expect, beforeEach } from "vitest";
import {
  collectScannable, isScannable, nextIndex, prevIndex, labelOf, activate, SCANNABLE_SELECTOR,
} from "./switch-scan";

/**
 * Pure switch-scan helpers: what's scannable, in what order, how to label and act on it.
 */

describe("nextIndex / prevIndex", () => {
  it("wraps forward and backward", () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
    expect(nextIndex(-1, 3)).toBe(0);
    expect(prevIndex(0, 3)).toBe(2);
    expect(prevIndex(2, 3)).toBe(1);
  });
  it("returns -1 for an empty list", () => {
    expect(nextIndex(0, 0)).toBe(-1);
    expect(prevIndex(0, 0)).toBe(-1);
  });
});

describe("collectScannable", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("includes enabled interactive controls and skips disabled/hidden ones", () => {
    document.body.innerHTML = `
      <button id="a">A</button>
      <button id="b" disabled>B</button>
      <a id="c" href="#x">C</a>
      <input id="d" />
      <input id="e" type="hidden" />
      <div id="f" role="button">F</div>
      <div id="g">plain</div>
    `;
    const ids = collectScannable(document).map((el) => el.id);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    expect(ids).toContain("d");
    expect(ids).toContain("f");
    expect(ids).not.toContain("b"); // disabled
    expect(ids).not.toContain("e"); // hidden input
    expect(ids).not.toContain("g"); // not interactive
  });

  it("skips aria-hidden controls", () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b" aria-hidden="true">B</button>`;
    // jsdom can't compute layout, so isScannable relies on hidden/aria flags here.
    expect(isScannable(document.getElementById("a")!)).toBe(true);
    expect(isScannable(document.getElementById("b")!)).toBe(false);
  });

  it("SCANNABLE_SELECTOR is a valid, non-empty selector", () => {
    expect(SCANNABLE_SELECTOR.length).toBeGreaterThan(0);
    expect(() => document.querySelectorAll(SCANNABLE_SELECTOR)).not.toThrow();
  });
});

describe("labelOf", () => {
  it("prefers aria-label, then text, then placeholder, then title, then tag", () => {
    const a = document.createElement("button");
    a.setAttribute("aria-label", "Save");
    a.textContent = "ignored";
    expect(labelOf(a)).toBe("Save");

    const b = document.createElement("button");
    b.textContent = "  Click me  ";
    expect(labelOf(b)).toBe("Click me");

    const c = document.createElement("input");
    c.setAttribute("placeholder", "Search");
    expect(labelOf(c)).toBe("Search");

    const d = document.createElement("input");
    expect(labelOf(d)).toBe("input");
  });
});

describe("activate", () => {
  it("clicks a button", () => {
    const btn = document.createElement("button");
    let clicked = false;
    btn.addEventListener("click", () => { clicked = true; });
    document.body.appendChild(btn);
    activate(btn);
    expect(clicked).toBe(true);
  });

  it("focuses a text field without clicking it", () => {
    const input = document.createElement("input");
    let clicked = false;
    input.addEventListener("click", () => { clicked = true; });
    document.body.appendChild(input);
    activate(input);
    expect(document.activeElement).toBe(input);
    expect(clicked).toBe(false);
  });
});
