import { createOmniStoreServer } from "./server";

/**
 * OmniStore container entrypoint — start the backend server. It speaks the broker sidecar wire
 * contract, so point any broker at it (BROKER_URL / SQL_SIDECAR_URL). Env: PORT, OMNISTORE_FILE
 * (durable path), OMNISTORE_KEY (base64-32), BROKER_PSK, SIDECAR_MAX_INFLIGHT.
 */
const port = Number(process.env["PORT"]) || 5702;
createOmniStoreServer().listen(port, () => {
  // eslint-disable-next-line no-console -- container startup line
  console.log(`OmniStore backend listening on :${port}`);
});
