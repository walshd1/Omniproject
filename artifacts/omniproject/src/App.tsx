import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { useStore } from "./store/useStore";

// Layout
import { AppLayout } from "./components/layout/AppLayout";

// Pages
import { Home } from "./pages/Home";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Settings } from "./pages/Settings";
import { Reports } from "./pages/Reports";
import { Login } from "./pages/Login";

const queryClient = new QueryClient();

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
      <Route path="/projects">
        <AppLayout><Projects /></AppLayout>
      </Route>
      <Route path="/projects/:projectId">
        {(params) => <AppLayout><ProjectDetail projectId={params.projectId} /></AppLayout>}
      </Route>
      <Route path="/reports">
        <AppLayout><Reports /></AppLayout>
      </Route>
      <Route path="/settings">
        <AppLayout><Settings /></AppLayout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeInitializer />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
