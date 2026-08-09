import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./env";
import { HttpError } from "./lib/authz";
import authRoutes from "./routes/auth";
import organizationRoutes from "./routes/organizations";
import eventRoutes from "./routes/events";
import publicRoutes from "./routes/public";

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
      connectSrc: ["'self'", "https://challenges.cloudflare.com", "https://*.posthog.com", "https://*.sentry.io"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      frameSrc: ["https://challenges.cloudflare.com"],
      frameAncestors: ["'none'"],
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

app.route("/api/auth", authRoutes);
app.route("/api/organizations", organizationRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/public", publicRoutes);

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
  if (error instanceof HttpError) {
    return context.json({ error: { code: error.code, message: error.message }, requestId: context.get("requestId") }, error.status);
  }
  console.error(JSON.stringify({ level: "error", requestId: context.get("requestId"), message: error.message }));
  return context.json(
    { error: { code: "internal_error", message: "Something went wrong." }, requestId: context.get("requestId") },
    500,
  );
});

export default app;
