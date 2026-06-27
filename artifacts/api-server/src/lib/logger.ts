/**
 * The shared pino logger — one configured instance for the whole gateway (level
 * from LOG_LEVEL, pretty in dev, JSON in prod). Import this rather than calling
 * console.* so every line is structured and redaction/levels apply uniformly.
 */
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    // Never emit OIDC tokens carried in user-context blocks.
    "token",
    "*.token",
    "userContext.token",
    "payload.userContext.token",
    "*.userContext.token",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
