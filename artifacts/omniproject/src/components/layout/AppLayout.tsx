import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { CommandPalette } from "../CommandPalette";
import { useStore } from "../../store/useStore";
import { useListProjects } from "@workspace/api-client-react";
import { Layers, Briefcase, Settings as SettingsIcon } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { currentLens, setCurrentLens, activeProjectId, theme } = useStore();
  const { data: projects } = useListProjects();

  const activeProject = projects?.find(p => p.id === activeProjectId) || projects?.[0];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shortcuts only when not in input/textarea
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;

      if (e.key === "g") {
        const nextKey = (ev: KeyboardEvent) => {
          if (ev.key === "d") setLocation("/");
          if (ev.key === "p") setLocation("/projects");
          if (ev.key === "s") setLocation("/settings");
          document.removeEventListener("keydown", nextKey);
        };
        document.addEventListener("keydown", nextKey);
        setTimeout(() => document.removeEventListener("keydown", nextKey), 1000);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setLocation]);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border flex flex-col bg-card shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-border font-bold text-xl tracking-tighter cursor-pointer" onClick={() => setLocation("/")}>
          <div className="bg-foreground text-background w-8 h-8 flex items-center justify-center mr-3 font-black">OP</div>
          OMNIPROJECT
        </div>
        
        <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
          <Link href="/" className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${location === "/" ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
            <Layers className="w-4 h-4 mr-3" /> Dashboard
            <span className="ml-auto text-[10px] opacity-50 bg-background px-1 border border-border">G+D</span>
          </Link>
          <Link href="/projects" className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${location.startsWith("/projects") ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
            <Briefcase className="w-4 h-4 mr-3" /> Projects
            <span className="ml-auto text-[10px] opacity-50 bg-background px-1 border border-border">G+P</span>
          </Link>
          <Link href="/settings" className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${location.startsWith("/settings") ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
            <SettingsIcon className="w-4 h-4 mr-3" /> Settings
            <span className="ml-auto text-[10px] opacity-50 bg-background px-1 border border-border">G+S</span>
          </Link>
        </nav>

        <div className="p-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>CMD+K TO SEARCH</span>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-background shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center border border-border bg-card p-1">
              <button 
                onClick={() => setCurrentLens('agile')}
                className={`px-3 py-1 text-xs font-bold uppercase ${currentLens === 'agile' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                AGILE
              </button>
              <button 
                onClick={() => setCurrentLens('gantt')}
                className={`px-3 py-1 text-xs font-bold uppercase ${currentLens === 'gantt' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                GANTT
              </button>
            </div>
            
            {activeProject && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">/</span>
                <span className="font-bold text-sm">{activeProject.name}</span>
                <span className="text-xs px-1.5 py-0.5 border border-border bg-muted/50 uppercase tracking-widest">{activeProject.source}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border border-border px-2 py-1 bg-card">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span className="text-xs font-bold tracking-widest">CONNECTED</span>
            </div>
            <div className="w-8 h-8 bg-foreground text-background flex items-center justify-center font-bold font-sans">
              ME
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-muted/20 relative">
          {children}
        </div>
      </main>

      <CommandPalette />
    </div>
  );
}
