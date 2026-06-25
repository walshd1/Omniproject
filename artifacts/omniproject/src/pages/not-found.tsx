import { Link } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-4">
      <div className="w-full max-w-md border-2 border-foreground bg-card p-8">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="h-8 w-8 text-primary shrink-0" />
          <h1 className="text-3xl font-black uppercase tracking-tighter">Page not found</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          The page you're looking for doesn't exist or has moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground border border-primary px-4 py-2 text-sm font-bold uppercase tracking-wider hover:bg-primary/90"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
