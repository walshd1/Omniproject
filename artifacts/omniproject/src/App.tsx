import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect, lazy, Suspense } from "react";
import { useStore } from "./store/useStore";
import { BrandingProvider } from "./lib/branding";
import { WorkVocabularyProvider } from "./lib/work-vocabulary";
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
import { useRoutedScreens } from "./lib/org-screens";

// Pages are code-split: each becomes its own chunk fetched on first visit, so the
// initial load no longer pays for Reports' charts, the Gantt, etc. (named exports
// → map to a default for React.lazy).
// The everyday pages are now hosted through the generic ScreenPage builder (via JSON screen defs +
// the `component` primitive registry in components/screen/screen-components), so they are no longer
// imported directly here — only the screens not yet migrated (Dashboards, ContentPages, Settings,
// Configurator, Resources capacity, Explore, Login) keep a direct route.
const Dashboards = lazy(() => import("./pages/Dashboards").then((m) => ({ default: m.Dashboards })));
const ContentPages = lazy(() => import("./pages/ContentPages").then((m) => ({ default: m.ContentPages })));
const Wiki = lazy(() => import("./pages/Wiki").then((m) => ({ default: m.Wiki })));
const Portal = lazy(() => import("./pages/Portal").then((m) => ({ default: m.Portal })));
const Whiteboards = lazy(() => import("./pages/Whiteboards").then((m) => ({ default: m.Whiteboards })));
const Proofs = lazy(() => import("./modules/proof").then((m) => ({ default: m.Proofs })));
const Goals = lazy(() => import("./pages/Goals").then((m) => ({ default: m.Goals })));
const Invoices = lazy(() => import("./pages/Invoices").then((m) => ({ default: m.Invoices })));
const Marketplace = lazy(() => import("./pages/Marketplace").then((m) => ({ default: m.Marketplace })));
const Registry = lazy(() => import("./pages/Registry").then((m) => ({ default: m.Registry })));
const Studio = lazy(() => import("./pages/Studio").then((m) => ({ default: m.Studio })));
const Definitions = lazy(() => import("./pages/Definitions").then((m) => ({ default: m.Definitions })));
const FieldMapping = lazy(() => import("./pages/FieldMapping").then((m) => ({ default: m.FieldMapping })));
const ScreenPage = lazy(() => import("./pages/ScreenPage").then((m) => ({ default: m.ScreenPage })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Configurator = lazy(() => import("./pages/Configurator").then((m) => ({ default: m.Configurator })));
const Resources = lazy(() => import("./pages/Resources").then((m) => ({ default: m.Resources })));
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
  // Effective routed screens = built-in catalogue + the org's stored/overridden defs (merged). Generated
  // as routes below, so an org-added screen (e.g. from a methodology bundle) becomes reachable with no code.
  const routedScreens = useRoutedScreens();
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
      <Route path="/wiki">
        <AppLayout><Wiki /></AppLayout>
      </Route>
      <Route path="/whiteboards">
        <AppLayout><Whiteboards /></AppLayout>
      </Route>
      <Route path="/proofs">
        <AppLayout><Proofs /></AppLayout>
      </Route>
      <Route path="/goals">
        <AppLayout><Goals /></AppLayout>
      </Route>
      <Route path="/invoices">
        <AppLayout><Invoices /></AppLayout>
      </Route>
      <Route path="/marketplace">
        <AppLayout><Marketplace /></AppLayout>
      </Route>
      <Route path="/registry">
        <AppLayout><Registry /></AppLayout>
      </Route>
      <Route path="/studio">
        <AppLayout><Studio /></AppLayout>
      </Route>
      <Route path="/definitions">
        <AppLayout><Definitions /></AppLayout>
      </Route>
      <Route path="/field-mapping">
        <AppLayout><FieldMapping /></AppLayout>
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
      {/* Project-scoped sub-screens (JSON defs matching the backend screen ids), threaded with :projectId.
          Listed before the :projectId detail route; wouter's single-segment param won't match these anyway. */}
      <Route path="/projects/:projectId/gantt">
        {(params) => <AppLayout><ScreenPage id="gantt" params={{ projectId: params.projectId }} /></AppLayout>}
      </Route>
      <Route path="/projects/:projectId/risks">
        {(params) => <AppLayout><ScreenPage id="risk-register" params={{ projectId: params.projectId }} /></AppLayout>}
      </Route>
      <Route path="/projects/:projectId/raci">
        {(params) => <AppLayout><ScreenPage id="raci-matrix" params={{ projectId: params.projectId }} /></AppLayout>}
      </Route>
      <Route path="/projects/:projectId/stakeholders">
        {(params) => <AppLayout><ScreenPage id="stakeholders" params={{ projectId: params.projectId }} /></AppLayout>}
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
      {/* Exploration mode is intentionally OUTSIDE the live AppLayout chrome. Hosted through the generic
          builder (bare, no header) so it too is a JSON screen def, but without the AppLayout wrapper. */}
      <Route path="/explore">
        <ScreenPage id="explore" />
      </Route>
      {/* Client-facing guest portal — BARE (no AppLayout), like /explore: a guest must never see the app
          chrome. Guests are bounced here from any AppLayout route (see AppLayout's guest guard). */}
      <Route path="/portal">
        <Portal />
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
      {/* Catalogue-owned artifact screens (JSON defs with a `route`, e.g. a methodology's Kanban board).
          The route is always mounted so a deep-link resolves; nav visibility is what the methodology
          composition gates (soft declutter, like the rest of the nav). */}
      {routedScreens.map((s) => (
        <Route key={s.id} path={s.route!}>
          <AppLayout><ScreenPage id={s.id} /></AppLayout>
        </Route>
      ))}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <WorkVocabularyProvider>
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
        </WorkVocabularyProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}

export default App;
