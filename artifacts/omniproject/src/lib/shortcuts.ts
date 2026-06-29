/**
 * Single source of truth for the app's keyboard shortcuts. The help overlay (ShortcutsDialog)
 * renders from this list, and it documents the shortcuts the app actually wires up elsewhere
 * (CommandPalette's ⌘/Ctrl+K, GlobalSearch's "/", AppLayout's "?" + G-chords, dialog Esc) — keeping
 * the cheatsheet and the real bindings from drifting. Every shortcut here also has a visible,
 * mouse-operable affordance (the command palette, the header Search button, the header "?" button,
 * the sidebar links), upholding the rule that nothing is keyboard-only.
 */

/** A single shortcut row: one or more key chips (a chord) + a human description. */
export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  heading: string;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    heading: "General",
    items: [
      { keys: ["⌘/Ctrl", "K"], label: "Open command palette" },
      { keys: ["/"], label: "Search projects, issues & programmes" },
      { keys: ["?"], label: "Show this help" },
      { keys: ["Esc"], label: "Close dialogs / palette / overlays" },
    ],
  },
  {
    heading: "Navigation",
    items: [
      { keys: ["G", "D"], label: "Go to Dashboard" },
      { keys: ["G", "P"], label: "Go to Projects" },
      { keys: ["G", "R"], label: "Go to Reports" },
      { keys: ["G", "E"], label: "Go to Explore" },
      { keys: ["G", "S"], label: "Go to Settings" },
    ],
  },
  {
    heading: "Cards & lists",
    items: [
      { keys: ["Enter"], label: "Open the focused card / issue" },
      { keys: ["Space"], label: "Activate the focused card / issue" },
      { keys: ["↑", "↓"], label: "Move within a list / results / palette" },
    ],
  },
];

/** Flat list of every shortcut (for tests / a future searchable palette of shortcuts). */
export function allShortcuts(): Shortcut[] {
  return SHORTCUT_GROUPS.flatMap((g) => g.items);
}
