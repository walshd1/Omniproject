import { LayoutGrid, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useStore } from "../store/useStore";
import { VIEWS, viewMeta, type CapabilityDomain } from "../lib/views";
import { useGetCapabilities, type Capabilities } from "@workspace/api-client-react";

/** Methodology view switcher — generalizes the old Agile/Gantt lens toggle. */
export function ViewSwitcher() {
  const { currentView, setCurrentView } = useStore();
  const active = viewMeta(currentView);
  const { data: caps } = useGetCapabilities();
  const missing = (d?: CapabilityDomain) => !!d && !!caps && caps[d as keyof Capabilities] === false;

  // Preserve declaration order while grouping by methodology family.
  const groups = VIEWS.reduce<Record<string, typeof VIEWS>>((acc, v) => {
    (acc[v.group] ??= []).push(v);
    return acc;
  }, {});

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 border border-border bg-card px-3 py-1.5 text-xs font-bold uppercase tracking-wider hover:border-primary"
        data-testid="view-switcher"
      >
        <LayoutGrid className="w-4 h-4" /> {active.short}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="rounded-none border-border w-72">
        {Object.entries(groups).map(([group, views], gi) => (
          <div key={group}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">{group}</DropdownMenuLabel>
            {views.map((v) => (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => setCurrentView(v.id)}
                className="flex flex-col items-start gap-0.5 cursor-pointer"
              >
                <span className="flex items-center gap-2 font-bold uppercase text-xs tracking-wider">
                  {v.id === currentView ? <Check className="w-3 h-3 text-primary" /> : <span className="w-3 h-3" />}
                  {v.label}
                  <span className="text-[9px] text-muted-foreground font-normal normal-case">· {v.methodology}</span>
                  {missing(v.needs) && (
                    <span className="text-[9px] text-amber-500 font-bold normal-case">· limited (no {v.needs})</span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground pl-5 normal-case font-normal">{v.description}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
