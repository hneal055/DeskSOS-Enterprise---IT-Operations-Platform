// Sentry error tracking (readiness plan task 3.5). Imported first in index.ts
// so Sentry can instrument http/express. Does nothing unless SENTRY_DSN is set.
import * as Sentry from "@sentry/node";
import config from "./config"; // loads .env / .env.production

// Never send credentials, API keys or request bodies (incident text, passwords)
const SENSITIVE_HEADERS = ["authorization", "x-api-key", "cookie", "set-cookie"];

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  const req = event.request;
  if (req) {
    delete req.data;
    delete req.cookies;
    if (req.headers) {
      for (const name of Object.keys(req.headers)) {
        if (SENSITIVE_HEADERS.includes(name.toLowerCase())) delete req.headers[name];
      }
    }
    if (typeof req.query_string === "string" && /token|key|password/i.test(req.query_string)) {
      delete req.query_string;
    }
  }
  return event;
}

export const SENTRY_ENABLED = Boolean(config.sentryDsn) && process.env.NODE_ENV !== "test";

if (SENTRY_ENABLED) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    // Errors only, no performance tracing. Personal data isn't sent by default;
    // scrubEvent also removes credentials and bodies from request data.
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
}
