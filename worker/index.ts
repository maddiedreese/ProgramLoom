import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./env";

type Variables = { requestId: string };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (context, next) => {
  const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("x-request-id", requestId);
});

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://*.posthog.com", "https://*.sentry.io"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      frameAncestors: ["'self'", "https:"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

app.get("/api/health", (context) =>
  context.json({
    status: "ok" as const,
    service: "programloom" as const,
    environment: context.env.APP_ENV,
    requestId: context.get("requestId"),
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/meta", (context) =>
  context.json({
    name: "ProgramLoom",
    version: "0.1.0",
    links: {
      application: context.env.APP_URL,
      marketing: context.env.MARKETING_URL,
      source: "https://github.com/maddiedreese/SaaS",
    },
  }),
);

app.notFound(async (context) => {
  if (context.req.path.startsWith("/api/")) {
    return context.json(
      { error: { code: "not_found", message: "The requested API route does not exist." }, requestId: context.get("requestId") },
      404,
    );
  }
  return context.env.ASSETS.fetch(context.req.raw);
});

app.onError((error, context) => {
  console.error(JSON.stringify({ level: "error", requestId: context.get("requestId"), message: error.message }));
  return context.json(
    { error: { code: "internal_error", message: "Something went wrong." }, requestId: context.get("requestId") },
    500,
  );
});

export default app;
