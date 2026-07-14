import { useApiDocsUrl } from "../lib/discovery";

/**
 * A discreet link to the optional in-app API portal (`GET /api/docs`). It renders ONLY when an
 * operator has enabled the portal (the URL is advertised in `/api/discovery`), so a deployment
 * that hasn't opted in shows nothing — the link can never point at a 404.
 */
export function ApiPortalLink() {
  const url = useApiDocsUrl();
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="api-portal-link"
      title="Browse the API reference (opens the API portal)"
      className="uppercase tracking-widest font-bold hover:text-foreground"
    >
      API
    </a>
  );
}
