import { useAuth } from "../lib/auth";
import { stepUp } from "../lib/step-up";
import { Button } from "@/components/ui/button";

/**
 * Shown while the current session is flagged for an implausible location jump from its
 * own last login (server-side: lib/impossible-travel.ts) and hasn't been re-verified
 * since. Not a lockout — everything keeps working — but the NEXT sensitive (admin/pmo)
 * action will demand a step-up regardless of the flag; this banner surfaces that up
 * front instead of the user hitting a surprise 403 mid-task.
 */
export function ImpossibleTravelBanner() {
  const { data: auth } = useAuth();
  if (!auth?.authenticated || !auth.impossibleTravel) return null;

  return (
    <div
      role="alert"
      data-testid="impossible-travel-banner"
      className="fixed inset-x-0 top-0 z-[9998] flex flex-wrap items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-bold text-black shadow-md"
    >
      <span>
        ⚠ This session logged in from an unusual location compared to last time. If this
        wasn't you, sign out. Otherwise, verify it's you before doing anything sensitive.
      </span>
      <Button size="sm" variant="outline" className="h-6 bg-background px-2 py-0 text-xs" onClick={() => void stepUp()}>
        Verify it's me
      </Button>
    </div>
  );
}
