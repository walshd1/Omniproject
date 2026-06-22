import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useStore } from "../store/useStore";
import { useLocation } from "wouter";

export function CommandPalette() {
  const { isCommandOpen, setCommandOpen, theme, toggleTheme, currentLens, setCurrentLens } = useStore();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen(!isCommandOpen);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [isCommandOpen, setCommandOpen]);

  if (!isCommandOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-background/80 backdrop-blur-sm">
      <Command
        className="w-full max-w-2xl bg-card border border-border shadow-2xl overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Escape") setCommandOpen(false);
        }}
      >
        <Command.Input 
          autoFocus 
          placeholder="Type a command or search..." 
          className="w-full px-4 py-3 text-lg bg-transparent border-b border-border outline-none text-foreground placeholder:text-muted-foreground font-mono"
        />
        <Command.List className="max-h-[300px] overflow-y-auto p-2">
          <Command.Empty className="p-4 text-sm text-center text-muted-foreground">No results found.</Command.Empty>
          
          <Command.Group heading="Navigation" className="px-2 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            <Command.Item
              onSelect={() => { setLocation("/"); setCommandOpen(false); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              Go to Dashboard
            </Command.Item>
            <Command.Item
              onSelect={() => { setLocation("/projects"); setCommandOpen(false); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              Go to Projects
            </Command.Item>
            <Command.Item
              onSelect={() => { setLocation("/settings"); setCommandOpen(false); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              Go to Settings
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Actions" className="px-2 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wider mt-4">
            <Command.Item
              onSelect={() => { setCurrentLens(currentLens === 'agile' ? 'gantt' : 'agile'); setCommandOpen(false); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              Switch Lens ({currentLens === 'agile' ? 'Gantt' : 'Agile'})
            </Command.Item>
            <Command.Item
              onSelect={() => { toggleTheme(); setCommandOpen(false); }}
              className="px-2 py-2 text-sm text-foreground hover:bg-accent cursor-pointer flex items-center gap-2"
            >
              Toggle Theme ({theme === 'dark' ? 'Light' : 'Dark'})
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
