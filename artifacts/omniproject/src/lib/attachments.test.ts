import { describe, it, expect } from "vitest";
import { attachmentsQueryKey, formatBytes } from "./attachments";

describe("attachments lib", () => {
  it("attachmentsQueryKey is stable and room-scoped", () => {
    expect(attachmentsQueryKey("issue:p1:i1")).toEqual(["attachments", "issue:p1:i1"]);
  });

  it("formatBytes renders human sizes (1024-based)", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe("3.5 GB");
    expect(formatBytes(-1)).toBe("");
  });
});
