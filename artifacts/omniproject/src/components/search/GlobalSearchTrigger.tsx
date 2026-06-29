import { Search } from "lucide-react";
import { useFeatures, featureEnabled } from "../../lib/features";
import { useGlobalSearch } from "../../lib/global-search";

/**
 * Header affordance that opens global search with the MOUSE (the keyboard path is "/"). Having both
 * upholds the rule that every action is operable by pointer and keyboard. Self-gates on the feature.
 */
export function GlobalSearchTrigger() {
  const { data: features } = useFeatures();
  const setOpen = useGlobalSearch((s) => s.setOpen);
  if (!featureEnabled(features, "globalSearch")) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Search"
      className="flex items-center gap-1.5 border border-border px-2 py-1 bg-card text-xs font-bold tracking-widest text-muted-foreground hover:text-foreground"
    >
      <Search className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden sm:inline rounded border border-border px-1 text-[10px]">/</kbd>
    </button>
  );
}
