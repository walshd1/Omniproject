import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { getBrokerLog, subscribeBrokerLog } from "../lib/broker-log";

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
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // don't let nginx buffer the stream
  });
  res.write("event: ready\ndata: {}\n\n");

  const unsubscribe = subscribeBrokerLog((entry) => {
    try {
      res.write(`event: entry\ndata: ${JSON.stringify(entry)}\n\n`);
    } catch {
      /* connection gone; cleanup runs on close */
    }
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);

  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

export default router;
