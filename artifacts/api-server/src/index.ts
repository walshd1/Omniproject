import app from "./app";
import { logger } from "./lib/logger";
import { isN8nConfigured } from "./lib/n8n";
import { isOidcConfigured } from "./lib/oidc";
import { getSettings } from "./lib/settings";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info(
    {
      port,
      dataMode: isN8nConfigured ? "n8n" : "demo (sample data)",
      auth: isOidcConfigured ? "oidc" : "demo",
      aiProvider: getSettings().aiProvider,
    },
    "Server listening",
  );
});
