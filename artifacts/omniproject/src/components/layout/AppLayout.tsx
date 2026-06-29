import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { CommandPalette } from "../CommandPalette";
import { NewTaskDialog } from "../NewTaskDialog";
import { ShortcutsDialog } from "../ShortcutsDialog";
import { IssueSidePanel } from "../sidepanel/IssueSidePanel";
import { NotificationsBell } from "../NotificationsBell";
import { useStore } from "../../store/useStore";
import { useListProjects, useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { LogOut, Menu } from "lucide-react";
import { useVisibleNavItems } from "../../lib/nav";
import { useAuth, logout } from "../../lib/auth";
import { useSetupStatus } from "../../lib/setup";
import { useT } from "../../lib/i18n";
import { useBranding } from "../../lib/branding";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { ErrorBoundary } from "../ErrorBoundary";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { activeProjectId, isNewIssueOpen, setNewIssueOpen, isShortcutsOpen, setShortcutsOpen } = useStore();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { t } = useT();
  const brand = useBranding();
  const { data: auth, isLoading: authLoading } = useAuth();
  const { data: setup } = useSetupStatus();
  const { data: projects } = useListProjects();
  const navItems = useVisibleNavItems();
  const health = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30_000, retry: false },
  });
  const connected = health.data?.status === "ok";

  // Fall back to the first project when none is explicitly active, so the global
  // Cmd+K "New Issue" dialog always has a target project.
  const activeProject = projects?.find(p => p.id === activeProjectId) || projects?.[0];
  const mainRef = useRef<HTMLDivElement>(null);

  // On route change, update the page title and move focus to the content region
  // so screen-reader / keyboard users land on the new view (SPA nav otherwise
  // announces nothing and leaves focus stranded).
  useEffect(() => {
    const seg = location.split("/")[1] || "dashboard";
    const name = seg.charAt(0).toUpperCase() + seg.slice(1);
    document.title = `${name} — ${brand.appName}`;
    mainRef.current?.focus();
    // Close the mobile nav drawer after navigating so the new view is visible.
    setMobileNavOpen(false);
  }, [location, brand.appName]);

  // Auth guard: wait for auth to resolve (so we don't bounce mid-load), then send
  // an authenticated-but-not-logged-in user to the login screen.
  useEffect(() => {
    if (!authLoading && auth && !auth.authenticated) {
      setLocation("/login");
    }
  }, [auth, authLoading, setLocation]);

  // Two-key "chord" navigation (g then d/p/r/s, like Gmail/GitHub): pressing 'g'
  // arms a one-shot listener for the destination key; it auto-disarms after the
  // chord window if no follow-up key arrives.
  useEffect(() => {
    const CHORD_WINDOW_MS = 1000;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in a field.
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
        setTimeout(() => document.removeEventListener("keydown", nextKey), CHORD_WINDOW_MS);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setLocation]);

  // "?" opens the keyboard-shortcuts help. Guarded against typing in a field
  // (same check as the chord handler) and against modifier combos.
  useEffect(() => {
    const handleHelpKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      if ((document.activeElement as HTMLElement | null)?.isContentEditable) return;
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    document.addEventListener("keydown", handleHelpKey);
    return () => document.removeEventListener("keydown", handleHelpKey);
  }, [setShortcutsOpen]);

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

  // Shared nav list, rendered identically in the static desktop sidebar and the
  // mobile drawer. `compact` drops the chord hints (meaningless on touch).
  const navList = (compact = false) => (
    <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = item.match(location);
        const demoDot = item.href === "/setup" && setup && !setup.broker.configured;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold border border-transparent ${active ? "bg-primary/10 text-primary border-primary/30" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
          >
            <Icon className="w-4 h-4 mr-3" /> {t(item.i18nKey)}
            {!compact && item.chord && <span className="ml-auto text-[10px] opacity-50 bg-background px-1 border border-border">{item.chord}</span>}
            {demoDot && <span className="ml-auto w-2 h-2 rounded-full bg-amber-500" title="Running in demo mode" />}
          </Link>
        );
      })}
    </nav>
  );

  const brandMark = (
    <>
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt="" className="h-8 mr-3 object-contain" />
      ) : (
        <div className="bg-foreground text-background w-8 h-8 flex items-center justify-center mr-3 font-black">{brand.shortName}</div>
      )}
      <span className="uppercase truncate">{brand.appName}</span>
    </>
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-2 focus:font-bold focus:uppercase focus:tracking-widest focus:text-xs"
      >
        Skip to content
      </a>
      {/* Sidebar — static on md+, replaced by a hamburger + drawer below md. */}
      <aside className="hidden md:flex w-64 border-r border-border flex-col bg-card shrink-0">
        <Link href="/" aria-label={`${brand.appName} — home`} className="h-14 flex items-center px-4 border-b border-border font-bold text-xl tracking-tighter">
          {brandMark}
        </Link>

        {navList()}

        <div className="p-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>CMD+K TO SEARCH</span>
        </div>
      </aside>

      {/* Mobile nav drawer (Radix handles focus trap + Escape). */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col bg-card md:hidden">
          <SheetTitle asChild>
            <Link href="/" aria-label={`${brand.appName} — home`} className="h-14 flex items-center px-4 border-b border-border font-bold text-xl tracking-tighter">
              {brandMark}
            </Link>
          </SheetTitle>
          {navList(true)}
          <div className="p-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>CMD+K TO SEARCH</span>
          </div>
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border flex items-center justify-between gap-2 px-3 sm:px-6 bg-background shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden text-muted-foreground hover:text-foreground"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            {activeProject && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-muted-foreground">/</span>
                <span className="font-bold text-sm truncate">{activeProject.name}</span>
                <span className="hidden sm:inline text-xs px-1.5 py-0.5 border border-border bg-muted/50 uppercase tracking-widest">{activeProject.source}</span>
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

        {setup && !setup.broker.configured && location !== "/setup" && (
          <div className="bg-amber-500/10 border-b border-amber-500/40 px-6 py-2 text-xs flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              {t("header.demoBanner")}
            </span>
            <Link href="/setup" className="font-black uppercase tracking-widest border border-amber-500/50 text-amber-600 dark:text-amber-400 px-2 py-1 hover:bg-amber-500 hover:text-background">
              {t("header.openSetup")}
            </Link>
          </div>
        )}
        <div id="main-content" ref={mainRef} tabIndex={-1} className="flex-1 overflow-auto bg-muted/20 relative outline-none">
          <ErrorBoundary key={location}>{children}</ErrorBoundary>
        </div>
      </main>

      <CommandPalette />
      <ShortcutsDialog open={isShortcutsOpen} onOpenChange={setShortcutsOpen} />
      {/* Global "new task" — requires an explicit project (a task always belongs
          to one); the board's in-context IssueDialog stays project-fixed. */}
      <NewTaskDialog open={isNewIssueOpen} onOpenChange={setNewIssueOpen} />
      {/* Slide-over work-item detail (the optional "sidePanel" module; self-gates via useFeatures). */}
      <IssueSidePanel />
    </div>
  );
}
