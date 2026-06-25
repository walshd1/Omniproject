import { describe, it, expect } from "vitest";
import {
  STATUS_COLORS,
  PRIORITY_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  PRIORITY_ORDER,
  PRIORITY_LABELS,
  STATUS_ACCENTS,
  statusColor,
  statusAccent,
  statusLabel,
  priorityColor,
  priorityLabel,
} from "./constants";

describe("constants tables", () => {
  it("STATUS_ORDER lists the conventional pipeline left→right", () => {
    expect(STATUS_ORDER).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "cancelled",
    ]);
  });

  it("PRIORITY_ORDER runs urgent→none", () => {
    expect(PRIORITY_ORDER).toEqual(["urgent", "high", "medium", "low", "none"]);
  });

  it("every status in STATUS_ORDER has a colour, label and accent", () => {
    for (const s of STATUS_ORDER) {
      expect(STATUS_COLORS[s]).toBeTruthy();
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_ACCENTS[s]).toBeTruthy();
    }
  });

  it("every priority in PRIORITY_ORDER has a colour and label", () => {
    for (const p of PRIORITY_ORDER) {
      expect(PRIORITY_COLORS[p]).toBeTruthy();
      expect(PRIORITY_LABELS[p]).toBeTruthy();
    }
  });
});

describe("statusColor / statusAccent / priorityColor", () => {
  it("returns known swatches for known values", () => {
    expect(statusColor("done")).toBe("bg-green-500");
    expect(statusColor("in_progress")).toBe("bg-amber-500");
    expect(statusAccent("todo")).toBe("border-t-blue-500");
    expect(priorityColor("urgent")).toBe("bg-red-500");
  });

  it("falls back to neutral swatches for unknown values", () => {
    expect(statusColor("To Do")).toBe("bg-zinc-400");
    expect(statusAccent("weird")).toBe("border-t-zinc-400");
    expect(priorityColor("blocker")).toBe("bg-zinc-400");
  });
});

describe("statusLabel / priorityLabel humanisation", () => {
  it("returns canonical labels for known values", () => {
    expect(statusLabel("in_review")).toBe("IN REVIEW");
    expect(priorityLabel("medium")).toBe("MEDIUM");
  });

  it("humanises unknown values (underscores/dashes → spaces, upper-cased)", () => {
    expect(statusLabel("waiting_on_qa")).toBe("WAITING ON QA");
    expect(statusLabel("ready-for-dev")).toBe("READY FOR DEV");
    expect(priorityLabel("super-high")).toBe("SUPER HIGH");
  });

  it("trims and collapses surrounding separators", () => {
    expect(statusLabel("__draft__")).toBe("DRAFT");
    expect(priorityLabel("-low-")).toBe("LOW");
  });
});
