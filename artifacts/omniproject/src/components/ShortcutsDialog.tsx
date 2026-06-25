import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** A single shortcut row: one or more key chips and a human description. */
interface Shortcut {
  /** Each entry is rendered as a Kbd; multiple entries form a KbdGroup chord. */
  keys: string[];
  label: string;
}

interface ShortcutGroup {
  heading: string;
  items: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    heading: "General",
    items: [
      { keys: ["⌘/Ctrl", "K"], label: "Open command palette" },
      { keys: ["?"], label: "Show this help" },
      { keys: ["Esc"], label: "Close dialogs / palette" },
    ],
  },
  {
    heading: "Navigation",
    items: [
      { keys: ["G", "D"], label: "Go to Dashboard" },
      { keys: ["G", "P"], label: "Go to Projects" },
      { keys: ["G", "R"], label: "Go to Reports" },
      { keys: ["G", "S"], label: "Go to Settings" },
    ],
  },
  {
    heading: "Cards & lists",
    items: [
      { keys: ["Enter"], label: "Open the focused card / issue" },
      { keys: ["Space"], label: "Activate the focused card / issue" },
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none border-2 border-foreground bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-black uppercase tracking-tighter">Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move around OmniProject without leaving the keyboard.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.heading} className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{group.heading}</h3>
              <dl className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-foreground">{item.label}</dt>
                    <dd>
                      <KbdGroup>
                        {item.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
