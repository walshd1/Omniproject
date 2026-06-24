import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { CommandPalette } from "../CommandPalette";
import { IssueDialog } from "../IssueDialog";
import { NotificationsBell } from "../NotificationsBell";
import { useStore } from "../../store/useStore";
import { useListProjects, useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { Layers, Briefcase, BarChart3, Settings as SettingsIcon, LogOut, PlugZap, Boxes } from "lucide-react";
import { useAuth, logout } from "../../lib/auth";
import { useSetupStatus } from "../../lib/setup";
import { useT } from "../../lib/i18n";
import { LanguageSwitcher } from "../LanguageSwitcher";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { activeProjectId, isNewIssueOpen, setNewIssueOpen } = useStore();
  const { t } = useT();
  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: setup } = useSetupStatus();
  const { data: projects } = useListProjects();
  const health = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30_000, retry: false },
  });
  const connected = health.data?.status === "ok";

  const activeProject = projects?.find(p => p.id === activeProjectId) || projects?.[0];
  const dialogProjectId = activeProject?.id ?? "";

  // Auth guard: bounce unauthenticated users to the login screen.
  useEffect(() => {
    if (!authLoading && auth && !auth.authenticated) {
      setLocation("/login");
    }
  }, [auth, authLoading, setLocation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shortcuts only when not in input/textarea
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;

      if (e.key === "g") {
        const nextKey = (ev: KeyboardEvent) => {
          if (ev.key === "d") setLocation("/");
          if (ev.key === "p") setLocation("/projects");
          if (ev.key === "r") setLocation("/reports");
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

  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground font-bold tracking-widest animate-pulse">
        AUTHENTICATING…
      </div>
    );
  }

  if (auth && !auth.authenticated) return null;

  const initials = (auth?.user?.name || auth?.user?.email || "ME")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "ME";

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
            <Layers className="w-4 h-4 mr-3" /> {t("nav.dashboard")}
            <span className="ml-auto text-[10px] opacity-50 bg-background px-1 border border-border">G+D</span>
          </Link>
          <Link href="/programmes" className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${location.startsWith("/programmes") ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
            <Boxes className="w-4 h-4 mr-3" /> {t("nav.programmes")}
          </Link>
          <Link href="/projects" className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${location.startsWith("/projects") ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
            <Briefcase className="w-4 h-4 mr-3" /> {t("nav.projects")}
            <span className="ml-auto text-[10px] opacity-50 bg-background px-1 border border-border">G+P</span>
          </Link>
          <Link href="/reports" className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${location.startsWith("/reports") ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
            <BarChart3 className="w-4 h-4 mr-3" /> {t("nav.reports")}
            <span className="ml-auto text-[10px] opacity-50 bg-background px-1 border border-border">G+R</span>
          </Link>
          <Link href="/settings" className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${location.startsWith("/settings") ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
            <SettingsIcon className="w-4 h-4 mr-3" /> {t("nav.settings")}
            <span className="ml-auto text-[10px] opacity-50 bg-background px-1 border border-border">G+S</span>
          </Link>
          <Link href="/setup" className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${location.startsWith("/setup") ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}>
            <PlugZap className="w-4 h-4 mr-3" /> {t("nav.setup")}
            {setup && !setup.n8n.configured && <span className="ml-auto w-2 h-2 rounded-full bg-amber-500" title="Running in demo mode" />}
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
            {activeProject && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">/</span>
                <span className="font-bold text-sm">{activeProject.name}</span>
                <span className="text-xs px-1.5 py-0.5 border border-border bg-muted/50 uppercase tracking-widest">{activeProject.source}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border border-border px-2 py-1 bg-card" title="Gateway health">
              <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500 animate-pulse"}`}></div>
              <span className="text-xs font-bold tracking-widest">{connected ? t("header.connected") : t("header.offline")}</span>
            </div>
            <LanguageSwitcher />
            <NotificationsBell />
            {auth?.role && (
              <span
                className="text-[10px] font-black uppercase tracking-widest border border-border px-1.5 py-0.5 text-muted-foreground"
                title="Your access level (from your identity provider's roles)"
              >
                {auth.role}
              </span>
            )}
            <div
              className="w-8 h-8 bg-foreground text-background flex items-center justify-center font-bold font-sans"
              title={auth?.user?.email || auth?.user?.name || "Account"}
            >
              {initials}
            </div>
            <button
              onClick={() => logout()}
              className="text-muted-foreground hover:text-foreground"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {setup && !setup.n8n.configured && location !== "/setup" && (
          <div className="bg-amber-500/10 border-b border-amber-500/40 px-6 py-2 text-xs flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              {t("header.demoBanner")}
            </span>
            <Link href="/setup" className="font-black uppercase tracking-widest border border-amber-500/50 text-amber-600 dark:text-amber-400 px-2 py-1 hover:bg-amber-500 hover:text-background">
              {t("header.openSetup")}
            </Link>
          </div>
        )}
        <div className="flex-1 overflow-auto bg-muted/20 relative">
          {children}
        </div>
      </main>

      <CommandPalette />
      {dialogProjectId && (
        <IssueDialog
          projectId={dialogProjectId}
          open={isNewIssueOpen}
          onOpenChange={setNewIssueOpen}
        />
      )}
    </div>
  );
}
