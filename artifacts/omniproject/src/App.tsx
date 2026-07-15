import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect, lazy, Suspense } from "react";
import { useStore } from "./store/useStore";
import { BrandingProvider } from "./lib/branding";
import { A11yProvider } from "./lib/a11y-prefs";
import { ThemeScopeProvider } from "./lib/theme-scope";
import { PlatformProvider } from "./lib/platform-context";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installDataQualityObserver } from "./lib/data-quality";
import { ErrorTelemetrySync } from "./components/ErrorTelemetrySync";
import { DevModeWatermark } from "./components/DevModeWatermark";
import { ImpossibleTravelBanner } from "./components/ImpossibleTravelBanner";
import { DevPerfOverlay } from "./components/DevPerfOverlay";
import { SessionTimeoutWatcher } from "./components/SessionTimeoutWatcher";
import { DevImpersonationControl } from "./components/DevImpersonationControl";
import { DevEntitlementsControl } from "./components/DevEntitlementsControl";
import { MessyDataControl } from "./components/MessyDataControl";
import { SwitchScanner } from "./components/SwitchScanner";
import { VoiceInput } from "./components/VoiceInput";

// Layout (eager — it wraps every authenticated route)
import { AppLayout } from "./components/layout/AppLayout";

// Pages are code-split: each becomes its own chunk fetched on first visit, so the
// initial load no longer pays for Reports' charts, the Gantt, etc. (named exports
// → map to a default for React.lazy).
// The everyday pages are now hosted through the generic ScreenPage builder (via JSON screen defs +
// the `component` primitive registry in components/screen/screen-components), so they are no longer
// imported directly here — only the screens not yet migrated (Dashboards, ContentPages, Settings,
// Configurator, Resources capacity, Explore, Login) keep a direct route.
const Dashboards = lazy(() => import("./pages/Dashboards").then((m) => ({ default: m.Dashboards })));
const ContentPages = lazy(() => import("./pages/ContentPages").then((m) => ({ default: m.ContentPages })));
const ScreenPage = lazy(() => import("./pages/ScreenPage").then((m) => ({ default: m.ScreenPage })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Configurator = lazy(() => import("./pages/Configurator").then((m) => ({ default: m.Configurator })));
const Resources = lazy(() => import("./pages/Resources").then((m) => ({ default: m.Resources })));
const Explore = lazy(() => import("./pages/Explore").then((m) => ({ default: m.Explore })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Serve cached data for 30s so back/forward nav is instant instead of
      // re-fetching every list on each visit; and don't refetch-all on tab
      // refocus (that caused a visible jank). Mutations still invalidate, so
      // writes always pull fresh data.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function DataQualityObserver() {
  useEffect(() => { installDataQualityObserver(); }, []);
  return null;
}

function ThemeInitializer() {
  const theme = useStore(s => s.theme);
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <AppLayout><ScreenPage id="home" /></AppLayout>
      </Route>
      <Route path="/my-work">
        <AppLayout><ScreenPage id="my-work" /></AppLayout>
      </Route>
      <Route path="/tasks">
        <AppLayout><ScreenPage id="tasks" /></AppLayout>
      </Route>
      <Route path="/dashboards">
        <AppLayout><Dashboards /></AppLayout>
      </Route>
      <Route path="/content">
        <AppLayout><ContentPages /></AppLayout>
      </Route>
      <Route path="/programmes">
        <AppLayout><ScreenPage id="programmes" /></AppLayout>
      </Route>
      <Route path="/programmes/:programmeId">
        {(params) => <AppLayout><ScreenPage id="programme-detail" params={{ programmeId: params.programmeId }} /></AppLayout>}
      </Route>
      <Route path="/projects">
        <AppLayout><ScreenPage id="projects" /></AppLayout>
      </Route>
      <Route path="/projects/:projectId">
        {(params) => <AppLayout><ScreenPage id="project-detail" params={{ projectId: params.projectId }} /></AppLayout>}
      </Route>
      <Route path="/budgets">
        <AppLayout><ScreenPage id="budget-plans" /></AppLayout>
      </Route>
      <Route path="/resource-planning">
        <AppLayout><ScreenPage id="resource-allocations" /></AppLayout>
      </Route>
      <Route path="/reports">
        <AppLayout><ScreenPage id="reports" /></AppLayout>
      </Route>
      <Route path="/resources">
        <AppLayout><Resources /></AppLayout>
      </Route>
      {/* Exploration mode is intentionally OUTSIDE the live AppLayout chrome. */}
      <Route path="/explore">
        <Explore />
      </Route>
      <Route path="/settings">
        <AppLayout><Settings /></AppLayout>
      </Route>
      <Route path="/configurator">
        <AppLayout><Configurator /></AppLayout>
      </Route>
      <Route path="/setup">
        <Redirect to="/configurator" />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <A11yProvider>
        <ThemeScopeProvider>
        <PlatformProvider>
        <TooltipProvider>
          <ThemeInitializer />
          <DataQualityObserver />
          <ErrorTelemetrySync />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ErrorBoundary>
              <Suspense
                fallback={
                  <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground font-bold tracking-widest animate-pulse">
                    LOADING…
                  </div>
                }
              >
                <Router />
              </Suspense>
            </ErrorBoundary>
            {/* Inside the router so it can time route switches; dev-mode-gated. */}
            <DevPerfOverlay />
          </WouterRouter>
          <Toaster />
          <SessionTimeoutWatcher />
          <SwitchScanner />
          <VoiceInput />
          <DevModeWatermark />
          <ImpossibleTravelBanner />
          <DevImpersonationControl />
          <DevEntitlementsControl />
          <MessyDataControl />
        </TooltipProvider>
        </PlatformProvider>
        </ThemeScopeProvider>
        </A11yProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}

export default App;
