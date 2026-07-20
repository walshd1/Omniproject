import { useEffect } from "react";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useListProjects } from "@workspace/api-client-react";
import { useStore } from "../store/useStore";
import { useLocation } from "wouter";
import { VIEWS } from "../lib/views";
import { useVisibleNavItems } from "../lib/nav";
import { SETTINGS_PANEL_KEYS, settingsPanelLabel } from "../lib/settings-panels";
import { reportCatalogue } from "@workspace/backend-catalogue";

// The full report catalogue is static data — compute the palette's jump targets once. Each id has a
// matching scroll-anchor on the Reports page (see pages/Reports.tsx), so ⌘K → report = exactly 2 actions.
const REPORT_JUMPS = reportCatalogue().map((r) => ({ id: r.id, label: r.label }));

export function CommandPalette() {
  const {
    isCommandOpen,
    setCommandOpen,
    theme,
    toggleTheme,
    currentView,
    setCurrentView,
    setNewIssueOpen,
    setNewProjectOpen,
    setShortcutsOpen,
    activeProjectId,
    setActiveProjectId,
    setSettingsJump,
    setReportsJump,
  } = useStore();
  const [, setLocation] = useLocation();
  const { data: projects } = useListProjects();
  const navItems = useVisibleNavItems();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setCommandOpen]);

  return (
    <Dialog.Root open={isCommandOpen} onOpenChange={setCommandOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
        <Dialog.Content
          aria-label="Command palette"
          aria-describedby={undefined}
          className="fixed left-1/2 top-32 z-50 w-full max-w-2xl -translate-x-1/2 bg-card border border-border shadow-2xl overflow-hidden focus:outline-none"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command className="w-full">
        <Command.Input
          autoFocus 
          placeholder="Type a command or search..." 
          className="w-full px-4 py-3 text-lg bg-transparent border-b border-border outline-none text-foreground placeholder:text-muted-foreground font-mono"
        />
        <Command.List className="max-h-[300px] overflow-y-auto p-2">
          <Command.Empty className="p-4 text-sm text-center text-muted-foreground">No results found.</Command.Empty>
          
          <Command.Group heading="Navigation" className="px-2 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Command.Item
                  key={item.href}
                  onSelect={() => { setLocation(item.href); setCommandOpen(false); }}
                  className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
                >
                  <Icon className="w-4 h-4 opacity-70" /> Go to {item.label}
                </Command.Item>
              );
            })}
          </Command.Group>

          <Command.Group heading="Actions" className="px-2 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wider mt-4">
            <Command.Item
              onSelect={() => { setNewIssueOpen(true); setCommandOpen(false); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              New Task
            </Command.Item>
            <Command.Item
              onSelect={() => { setNewProjectOpen(true); setCommandOpen(false); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              New Project
            </Command.Item>
            <Command.Item
              onSelect={() => { toggleTheme(); setCommandOpen(false); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              Toggle Theme ({theme === 'dark' ? 'Light' : 'Dark'})
            </Command.Item>
            <Command.Item
              onSelect={() => { setCommandOpen(false); setShortcutsOpen(true); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              Keyboard shortcuts
            </Command.Item>
          </Command.Group>

          {projects && projects.length > 0 && (
            <Command.Group heading="Jump to project" className="px-2 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wider mt-4">
              {projects.map((p) => (
                <Command.Item
                  key={p.id}
                  value={`project ${p.identifier} ${p.name}`}
                  onSelect={() => { setActiveProjectId(p.id); setLocation("/"); setCommandOpen(false); }}
                  className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
                >
                  {p.id === activeProjectId ? "● " : ""}
                  <span className="font-mono text-xs text-muted-foreground">{p.identifier}</span> {p.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Settings" className="px-2 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wider mt-4">
            {SETTINGS_PANEL_KEYS.map((key) => (
              <Command.Item
                key={key}
                value={`settings ${settingsPanelLabel(key)}`}
                onSelect={() => { setSettingsJump(key); setLocation("/settings"); setCommandOpen(false); }}
                className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
              >
                Settings · {settingsPanelLabel(key)}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Reports" className="px-2 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wider mt-4">
            {REPORT_JUMPS.map((r) => (
              <Command.Item
                key={r.id}
                value={`report ${r.label}`}
                onSelect={() => { setReportsJump(r.id); setLocation("/reports"); setCommandOpen(false); }}
                className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
              >
                Report · {r.label}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Views" className="px-2 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wider mt-4">
            {VIEWS.map((v) => (
              <Command.Item
                key={v.id}
                onSelect={() => { setCurrentView(v.id); setLocation("/"); setCommandOpen(false); }}
                className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
              >
                {v.id === currentView ? "● " : ""}{v.label} <span className="text-muted-foreground text-xs">· {v.methodology}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
