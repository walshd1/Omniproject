import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresenceAvatars } from "./PresenceAvatars";
import type { PresencePeer } from "../../lib/presence";

const peer = (over: Partial<PresencePeer> = {}): PresencePeer =>
  ({ cid: "c1", sub: "u1", label: "Ada Lovelace", color: "#2563eb", editing: null, editingAt: 0, ...over });

describe("PresenceAvatars", () => {
  it("renders nothing when no one else is here", () => {
    const { container } = render(<PresenceAvatars peers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows an avatar per peer with their name available to screen readers", () => {
    render(<PresenceAvatars peers={[peer(), peer({ cid: "c2", label: "Bo Diddley" })]} />);
    const group = screen.getByTestId("presence-avatars");
    expect(group).toHaveAttribute("aria-label", expect.stringContaining("Ada Lovelace"));
    expect(screen.getByText("AL")).toBeInTheDocument(); // initials
    expect(screen.getByText("BD")).toBeInTheDocument();
  });

  it("collapses overflow beyond the max into a +N chip", () => {
    const peers = Array.from({ length: 6 }, (_, i) => peer({ cid: `c${i}`, label: `User ${i}` }));
    render(<PresenceAvatars peers={peers} max={4} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("notes an editing peer for screen readers", () => {
    render(<PresenceAvatars peers={[peer({ editing: "status" })]} />);
    expect(screen.getByText(/editing status/)).toBeInTheDocument();
  });
});
