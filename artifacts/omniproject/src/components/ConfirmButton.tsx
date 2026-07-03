import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

/**
 * Wraps a destructive/consequential trigger button in an AlertDialog confirmation. The
 * trigger keeps the original button's classes/content; `onConfirm` runs only after the
 * user accepts, so a single misclick can never fire the action. RBAC gating stays on the
 * caller (render this only where the caller has already checked role/permission).
 *
 * Shared across admin screens — prefer this over a bare `window.confirm`/`window.prompt`:
 * those block the whole tab, aren't stylable/accessible the same way, and (for `prompt`)
 * can't show rich content like "this signs everyone out" alongside an input field.
 */
export function ConfirmButton({
  className,
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  triggerTitle,
  testId,
}: {
  className: string;
  children: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Tooltip / accessible label for an icon-only trigger button. */
  triggerTitle?: string;
  /** data-testid on the trigger button, for tests that need to find it directly. */
  testId?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" disabled={disabled} className={className} title={triggerTitle} aria-label={triggerTitle} data-testid={testId}>
          {children}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-red-500 text-background hover:bg-red-600">
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
