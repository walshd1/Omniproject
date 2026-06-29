import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { getBrokerLog, subscribeBrokerLog } from "../lib/broker-log";
import { openSse, keepAlive } from "../lib/sse";

/**
 * Admin-only live broker log. GET returns the current ring (initial load +
 * export); the SSE stream pushes new entries live. Admin-gated because it
 * reveals backend activity + actors.
 */
const router = Router();

router.get("/admin/broker-log", requireRole("admin"), (_req, res) => {
  res.json(getBrokerLog());
});

router.get("/admin/broker-log/stream", requireRole("admin"), (req, res) => {
  const stream = openSse(res);
  const unsubscribe = subscribeBrokerLog((entry) => stream.send("entry", entry));
  keepAlive(stream, req, unsubscribe);
});

export default router;
