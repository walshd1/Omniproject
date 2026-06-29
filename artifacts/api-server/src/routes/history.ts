import { Router } from "express";
import { getBroker, contextFromReq, respondBrokerError } from "../broker";
import { isTimeTravelEnabled } from "../lib/settings";

/**
 * Time-travel replay — read recorded portfolio states back from the operator's
 * logging server (via the broker). Gated: returns 409 unless the operator has
 * opted into the logging-server egress, since without it there is no recorded
 * history to replay. OmniProject stores nothing; it is a stateless lens over the
 * operator's log.
 */
const router = Router();

router.get("/history/replay", async (req, res) => {
  if (!isTimeTravelEnabled()) {
    res.status(409).json({ error: "Time-travel is not enabled. Enable the logging server in settings to retain and replay history." });
    return;
  }
  const from = typeof req.query["from"] === "string" ? (req.query["from"] as string) : undefined;
  const to = typeof req.query["to"] === "string" ? (req.query["to"] as string) : undefined;
  try {
    res.json(await getBroker().replay(contextFromReq(req), { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }));
  } catch (err) {
    req.log.error({ err }, "history replay failed");
    respondBrokerError(res, err);
  }
});

export default router;
