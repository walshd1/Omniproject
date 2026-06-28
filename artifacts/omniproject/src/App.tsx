import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect, lazy, Suspense } from "react";
import { useStore } from "./store/useStore";
import { BrandingProvider } from "./lib/branding";
import { A11yProvider } from "./lib/a11y-prefs";
import { PlatformProvider } from "./lib/platform-context";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DevModeWatermark } from "./components/DevModeWatermark";
import { DevPerfOverlay } from "./components/DevPerfOverlay";
import { SessionTimeoutWatcher } from "./components/SessionTimeoutWatcher";
import { DevImpersonationControl } from "./components/DevImpersonationControl";
import { DevEntitlementsControl } from "./components/DevEntitlementsControl";
import { SwitchScanner } from "./components/SwitchScanner";
import { VoiceInput } from "./components/VoiceInput";

// Layout (eager — it wraps every authenticated route)
import { AppLayout } from "./components/layout/AppLayout";

// Pages are code-split: each becomes its own chunk fetched on first visit, so the
// initial load no longer pays for Reports' charts, the Gantt, etc. (named exports
// → map to a default for React.lazy).
const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const Programmes = lazy(() => import("./pages/Programmes").then((m) => ({ default: m.Programmes })));
const ProgrammeDetail = lazy(() => import("./pages/ProgrammeDetail").then((m) => ({ default: m.ProgrammeDetail })));
const Projects = lazy(() => import("./pages/Projects").then((m) => ({ default: m.Projects })));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail").then((m) => ({ default: m.ProjectDetail })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Setup = lazy(() => import("./pages/Setup").then((m) => ({ default: m.Setup })));
const Reports = lazy(() => import("./pages/Reports").then((m) => ({ default: m.Reports })));
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
        <AppLayout><Home /></AppLayout>
      </Route>
      <Route path="/programmes">
        <AppLayout><Programmes /></AppLayout>
      </Route>
      <Route path="/programmes/:programmeId">
        {(params) => <AppLayout><ProgrammeDetail programmeId={params.programmeId} /></AppLayout>}
      </Route>
      <Route path="/projects">
        <AppLayout><Projects /></AppLayout>
      </Route>
      <Route path="/projects/:projectId">
        {(params) => <AppLayout><ProjectDetail projectId={params.projectId} /></AppLayout>}
      </Route>
      <Route path="/reports">
        <AppLayout><Reports /></AppLayout>
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
      <Route path="/setup">
        <AppLayout><Setup /></AppLayout>
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
        <PlatformProvider>
        <TooltipProvider>
          <ThemeInitializer />
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
          <DevImpersonationControl />
          <DevEntitlementsControl />
        </TooltipProvider>
        </PlatformProvider>
        </A11yProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}

export default App;
