import type { VerificationStatus } from "@workspace/backend-catalogue";
import { StatusBadge, type StatusMeta } from "../StatusBadge";

const META: Record<VerificationStatus, StatusMeta> = {
  verified: {
    label: "VERIFIED",
    cls: "border-green-500/40 text-green-600 dark:text-green-400 bg-green-500/10",
    title: "Exercised end-to-end against a live instance of this backend.",
  },
  catalogued: {
    label: "CATALOGUED",
    cls: "border-border text-muted-foreground bg-muted/40",
    title: "Built from this vendor's public API docs — not yet run against a live instance. Verify against your own instance before relying on it.",
  },
  experimental: {
    label: "EXPERIMENTAL",
    cls: "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10",
    title: "Speculative or partial — treat this as a starting point, not a finished mapping.",
  },
};

/**
 * Honesty signal for how much to trust a backend's mapping before wiring it up —
 * see `VerificationStatus` in `lib/backend-catalogue/src/backend-manifest.ts` and
 * the catalogue-freeze policy in `lib/backend-catalogue/vendors/README.md`.
 * Defaults to "catalogued" (the posture of every shipped backend today) for a
 * missing/unrecognised value.
 */
export function VerificationBadge({
  verification,
  className = "",
}: {
  verification?: VerificationStatus | undefined;
  className?: string;
}) {
  return <StatusBadge value={verification} meta={META} fallback="catalogued" className={className} />;
}
