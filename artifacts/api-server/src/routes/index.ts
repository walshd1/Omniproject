import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import authRouter, { getSession } from "./auth";
import n8nProxyRouter from "./n8n-proxy";
import projectsRouter from "./projects";

const router: IRouter = Router();

/**
 * Gate protected routes behind a valid session. Works in both OIDC and demo
 * mode — in demo mode `/api/auth/login` issues a local session cookie, so the
 * UI's auth guard still drives the user through a login step.
 */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Public routes: health probes + auth flow.
router.use(healthRouter);
router.use(authRouter);

// Protected routes: require an authenticated session.
router.use(requireAuth, n8nProxyRouter);
router.use(requireAuth, projectsRouter);

export default router;
