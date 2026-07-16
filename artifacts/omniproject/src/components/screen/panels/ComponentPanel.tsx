import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { SCREEN_COMPONENTS, type ScreenComponentProps } from "../screen-components";

/**
 * Component panel — hosts a full registered SPA component (a page's bespoke content) as a panel, for the
 * cases the generic primitives can't reproduce without regression. config: { component: <registry id>,
 * ...props }. The remaining config keys are passed as props, so a route param threaded onto the panel
 * (projectId / programmeId) reaches the hosted component. Lazy, so each hosted page stays its own chunk;
 * wrapped in Suspense with a light fallback. An unknown id degrades to a labelled placeholder.
 */
export function ComponentPanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const id = String(c["component"] ?? "");
  const Cmp = SCREEN_COMPONENTS[id];

  if (!Cmp) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="unknown-component">
            {panel.title ?? panel.id}: no component registered for “{id}”.
          </p>
        </CardContent>
      </Card>
    );
  }

  const props: ScreenComponentProps = {};
  if (typeof c["projectId"] === "string") props.projectId = c["projectId"] as string;
  if (typeof c["programmeId"] === "string") props.programmeId = c["programmeId"] as string;

  return (
    <div className="h-full" data-testid={`component-panel-${id}`}>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground" data-testid={`component-loading-${id}`}>Loading…</div>}>
        <Cmp {...props} />
      </Suspense>
    </div>
  );
}
