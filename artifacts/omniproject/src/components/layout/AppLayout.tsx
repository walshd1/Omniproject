import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { CommandPalette } from "../CommandPalette";
import { NewTaskDialog } from "../NewTaskDialog";
import { NewProjectDialog } from "../NewProjectDialog";
import { ShortcutsDialog } from "../ShortcutsDialog";
import { IssueSidePanel } from "../sidepanel/IssueSidePanel";
import { GlobalSearch } from "../search/GlobalSearch";
import { GlobalSearchTrigger } from "../search/GlobalSearchTrigger";
import { NotificationsBell } from "../NotificationsBell";
import { DataQualityBadge } from "../DataQualityBadge";
import { ApiPortalLink } from "../ApiPortalLink";
import { useStore } from "../../store/useStore";
import { useListProjects, useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { LogOut, Menu, ChevronDown, ShieldCheck, Flag, DownloadCloud } from "lucide-react";
import { ReportProblemDialog } from "../ReportProblemDialog";
import { useNavShelves, type NavItem } from "../../lib/nav";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth, logout } from "../../lib/auth";
import { usePublicSetupStatus } from "../../lib/setup";
import { useT } from "../../lib/i18n";
import { useOnline, connectivityState } from "../../lib/connectivity";
import { useInstallPrompt } from "../../lib/use-install-prompt";
import { useOfflineCacheSync } from "../../lib/use-offline-cache";
import { useBranding } from "../../lib/branding";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { ThemeScope } from "../../lib/theme-scope";
import { ScopedThemeControl } from "../settings/ScopedThemeControl";
import { ErrorBoundary } from "../ErrorBoundary";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/** True when focus is in a text-entry surface, so a global keyboard shortcut should stand down. */
function isTypingInField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || !!el?.isContentEditable;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  // Per-screen theme scope: keyed by the top-level section so a user can re-theme "the Reports
  // screen" (etc.) for themselves — session-only by default, saveable to their profile.
  const screenSeg = location.split("/")[1] || "home";
  const screenScopeId = `screen:${screenSeg}`;
  const pageName = `${screenSeg.charAt(0).toUpperCase()}${screenSeg.slice(1)}`;
  const screenLabel = `${pageName} screen`;
  const { activeProjectId, isNewIssueOpen, setNewIssueOpen, isNewProjectOpen, setNewProjectOpen, isShortcutsOpen, setShortcutsOpen } = useStore();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { t } = useT();
  const brand = useBranding();
  const { data: auth, isLoading: authLoading, isError: authError } = useAuth();
  const { data: setup } = usePublicSetupStatus();
  const { data: projects } = useListProjects();
  // Progressive disclosure: plain PMs keep the Advanced (governance/config) shelf
  // collapsed; admin/PMO see it expanded. The toggle lets anyone reveal it —
  // capability is never removed, only its default visibility in the chrome.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { primary: primaryNav, admin: adminNav, adminVisible } = useNavShelves(advancedOpen);
  const health = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30_000, retry: false },
  });
  // Connectivity = device network (navigator.onLine) + gateway health. Device-offline reads differently
  // from a reachable-but-unhealthy gateway (see lib/connectivity).
  const online = useOnline();
  const conn = connectivityState(online, health.data?.status === "ok");
  const connected = conn === "connected";
  const { canInstall, promptInstall } = useInstallPrompt();
  useOfflineCacheSync(); // hydrate + persist the my-work/tasks read models when the offline cache is opted in

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
  // an unauthenticated user to the login screen. Fail CLOSED — `/api/auth/me` throws on
  // any non-OK (401/500/network) with retry:false, so an error must be treated as "not logged
  // in" and bounce to login, not left as undefined (which would render the full shell fail-open).
  useEffect(() => {
    if (!authLoading && (authError || (auth && !auth.authenticated))) {
      setLocation("/login");
    }
  }, [auth, authLoading, authError, setLocation]);

  // Guest guard: a GUEST principal (client-portal, below viewer) may see ONLY the bare /portal — never the
  // app shell. It's already 403'd on every app API by the gateway's viewer-floor gate; this bounces it out
  // of the chrome so it doesn't render a shell full of empty/denied panels. /portal is outside AppLayout,
  // so the guest is never redirected away from the portal itself.
  useEffect(() => {
    if (!authLoading && auth?.authenticated && auth.role === "guest") {
      setLocation("/portal");
    }
  }, [auth, authLoading, setLocation]);

  // Two-key "chord" navigation (g then d/p/r/s, like Gmail/GitHub): pressing 'g'
  // arms a one-shot listener for the destination key; it auto-disarms after the
  // chord window if no follow-up key arrives.
  useEffect(() => {
    const CHORD_WINDOW_MS = 1000;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in a field.
      if (isTypingInField()) return;

      if (e.key === "g") {
        const nextKey = (ev: KeyboardEvent) => {
          if (ev.key === "d") setLocation("/");
          if (ev.key === "p") setLocation("/projects");
          if (ev.key === "r") setLocation("/reports");
          if (ev.key === "e") setLocation("/explore");
          if (ev.key === "s") setLocation("/settings");
          if (ev.key === "c") setLocation("/configurator");
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
      if (isTypingInField()) return;
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

  // Don't render the authenticated shell for an unauthenticated OR errored auth state (the effect
  // above redirects to /login; returning null here prevents a fail-open flash of the app).
  if (authError || (auth && !auth.authenticated)) return null;
  // Nor for a guest — the effect above bounces it to /portal; returning null avoids a flash of the shell.
  if (auth?.role === "guest") return null;

  const initials = (auth?.user?.name || auth?.user?.email || "ME")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "ME";

  // A single nav row (link + active state + chord hint + demo dot). Shared by the
  // primary shelf and the collapsed Advanced shelf so they render identically.
  const navRow = (item: NavItem, compact: boolean) => {
    const Icon = item.icon;
    const active = item.match(location);
    const demoDot = item.href === "/configurator" && setup && !setup.broker.configured;
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
  };

  // Shared nav list, rendered identically in the static desktop sidebar and the
  // mobile drawer. `compact` drops the chord hints (meaningless on touch). The
  // everyday (primary) surfaces render flat; the heavy Advanced surfaces live in
  // a Collapsible (a real <button> trigger → keyboard-operable for free), open by
  // default for admin/PMO and reachable by everyone else via the toggle.
  const navList = (compact = false) => (
    <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
      {primaryNav.map((item) => navRow(item, compact))}
      {adminNav.length > 0 && (
        <Collapsible open={adminVisible} onOpenChange={setAdvancedOpen} className="mt-2 pt-2 border-t border-border">
          <CollapsibleTrigger className="flex w-full items-center px-3 py-2 text-sm uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent">
            <ShieldCheck className="w-4 h-4 mr-3" /> {t("nav.advanced")}
            <ChevronDown className={`ml-auto w-4 h-4 transition-transform ${adminVisible ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1 pt-1">
            {adminNav.map((item) => navRow(item, compact))}
          </CollapsibleContent>
        </Collapsible>
      )}
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
          <ApiPortalLink />
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
            {canInstall && (
              <button type="button" data-testid="pwa-install" onClick={() => void promptInstall()}
                className="flex items-center gap-1.5 border border-border px-2 py-1 bg-card text-xs font-bold tracking-widest hover:bg-muted"
                title="Install OmniProject as an app">
                <DownloadCloud className="w-3.5 h-3.5" /> {t("header.install")}
              </button>
            )}
            <div className="flex items-center gap-2 border border-border px-2 py-1 bg-card" data-testid="connectivity"
              title={conn === "offline" ? "No network connection" : conn === "unreachable" ? "Gateway unreachable" : "Gateway health"}
              role="status" aria-live="polite">
              <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : conn === "unreachable" ? "bg-amber-500 animate-pulse" : "bg-red-500 animate-pulse"}`}></div>
              <span className="text-xs font-bold tracking-widest">{connected ? t("header.connected") : t("header.offline")}</span>
            </div>
            <DataQualityBadge />
            <GlobalSearchTrigger />
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              aria-label="Report a problem"
              title="Report a problem"
              className="flex h-7 w-7 items-center justify-center border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <Flag className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="flex h-7 w-7 items-center justify-center border border-border bg-card text-xs font-black text-muted-foreground hover:text-foreground"
            >
              ?
            </button>
            <LanguageSwitcher />
            <ScopedThemeControl scopeId={screenScopeId} label={screenLabel} />
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

        {setup && !setup.broker.configured && location !== "/configurator" && (
          <div className="bg-amber-500/10 border-b border-amber-500/40 px-6 py-2 text-xs flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              {t("header.demoBanner")}
            </span>
            <Link href="/configurator" className="font-black uppercase tracking-widest border border-amber-500/50 text-amber-600 dark:text-amber-400 px-2 py-1 hover:bg-amber-500 hover:text-background">
              {t("header.openSetup")}
            </Link>
          </div>
        )}
        <div id="main-content" ref={mainRef} tabIndex={-1} role="region" aria-label={`${pageName}, main content`} className="flex-1 overflow-auto bg-muted/20 relative outline-none">
          <ThemeScope scopeId={screenScopeId} className="min-h-full">
            <ErrorBoundary key={location}>{children}</ErrorBoundary>
          </ThemeScope>
        </div>
      </main>

      <CommandPalette />
      <ShortcutsDialog open={isShortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} />
      {/* Global "new task" — requires an explicit project (a task always belongs
          to one); the board's in-context IssueDialog stays project-fixed. */}
      <NewTaskDialog open={isNewIssueOpen} onOpenChange={setNewIssueOpen} />
      <NewProjectDialog open={isNewProjectOpen} onOpenChange={setNewProjectOpen} />
      {/* Slide-over work-item detail (the optional "sidePanel" module; self-gates via useFeatures). */}
      <IssueSidePanel />
      {/* Cross-entity quick-find (the optional "globalSearch" module; self-gates via useFeatures). */}
      <GlobalSearch />
    </div>
  );
}
