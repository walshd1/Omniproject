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
    // The IdP bearer/id tokens are stored on the session under these names (routes/auth.ts), so a
    // serialized session object would leak a live credential without these paths.
    "accessToken",
    "*.accessToken",
    "idToken",
    "*.idToken",
    // Refresh tokens are longer-lived than access tokens — never surface one.
    "refreshToken",
    "*.refreshToken",
    // PKCE secrets: the code_verifier is the single-flow secret an OAuth2/OIDC login is built on.
    // Nothing logs these as objects today, but redacting pre-empts any future `logger.x({ verifier })`
    // from ever writing one in clear text. (These field names are only ever PKCE secrets, so there is
    // no legitimate-field over-redaction risk — unlike `state`/`nonce`, which are semi-public and left
    // loggable for debuggability.)
    "verifier",
    "*.verifier",
    "codeVerifier",
    "*.codeVerifier",
    // A password should never reach a log line; redact defensively regardless of nesting.
    "password",
    "*.password",
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
