import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
// BrandingProvider nests an I18nProvider internally, so this single wrapper
// satisfies both useBranding and useT for any component under test.
import { BrandingProvider } from "../lib/branding";

/**
 * Test render helper. Wraps the UI in the providers the app's data components
 * rely on (a fresh, retry-disabled QueryClient + Radix tooltip context) and
 * returns the QueryClient so a test can pre-seed query caches with
 * `qc.setQueryData(key, data)` instead of hitting the network.
 */
export function renderWithProviders(ui: ReactElement, opts: { client?: QueryClient } = {}) {
  const queryClient =
    opts.client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );

  return { ...render(ui, { wrapper: Wrapper }), queryClient };
}
