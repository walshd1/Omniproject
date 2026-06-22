import { Router, type IRouter } from "express";
import healthRouter from "./health";
import n8nProxyRouter from "./n8n-proxy";
import projectsRouter from "./projects";

const router: IRouter = Router();

router.use(healthRouter);
router.use(n8nProxyRouter);
router.use(projectsRouter);

export default router;
