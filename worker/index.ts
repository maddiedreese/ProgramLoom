import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./env";
import { HttpError } from "./lib/authz";
import authRoutes from "./routes/auth";
import organizationRoutes from "./routes/organizations";
import eventRoutes from "./routes/events";
import publicRoutes from "./routes/public";
import reviewRoutes from "./routes/reviews";
import speakerRoutes from "./routes/speakers";
import agendaRoutes from "./routes/agenda";
import widgetRoutes from "./routes/widgets";
import crmRoutes from "./routes/crm";
import integrationRoutes from "./routes/integrations";
import contentRoutes from "./routes/content";
import communicationRoutes from "./routes/communications";
import calendarRoutes from "./routes/calendar";
import controlRoomRoutes from "./routes/control-room";
import submissionWorkspaceRoutes from "./routes/submission-workspace";
import eventTemplateRoutes from "./routes/event-templates";
import searchRoutes from "./routes/search";
import notificationRoutes from "./routes/notifications";
import reviewRoutingRoutes from "./routes/review-routing";
import developerAdminRoutes from "./routes/developer-admin";
import developerApiRoutes from "./routes/developer-api";
import developerOauthRoutes, { oauthMetadata } from "./routes/developer-oauth";
import {
  cleanupNotificationRetention,
  createOverdueTaskNotificationsAndDispatchEmails,
} from "./lib/notifications";
import {
  beginAirtableReconciliation,
  dispatchPendingAirtableOutbox,
  finishAirtableReconciliation,
  processAirtableOutbox,
  queueAirtableAudits,
  reconcileAirtableOrganizations,
  refreshAirtableWebhook,
} from "./lib/airtable";
import { cleanupEphemeralWorkspaceState } from "./lib/maintenance";
import {
  dispatchScheduledCommunications,
  processCommunication,
  type CommunicationJob,
} from "./lib/communications";
import {
  dispatchPendingDeveloperWebhooks,
  processDeveloperWebhook,
  queueDeveloperWebhookAudits,
} from "./lib/developerPlatform";

type Variables = { requestId: string };

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (context, next) => {
  const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("x-request-id", requestId);
});

app.use("/api/*", async (context, next) => {
  await next();
  if (
    !["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method) ||
    context.res.status >= 400 ||
    !context.env.DB
  )
    return;
  try {
    await queueAirtableAudits(context.env, context.get("requestId"));
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "airtable_outbox",
        requestId: context.get("requestId"),
        message:
          error instanceof Error ? error.message : "Outbox dispatch failed.",
      }),
    );
  }
  try {
    await queueDeveloperWebhookAudits(context.env, context.get("requestId"));
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "developer_webhook_outbox",
        requestId: context.get("requestId"),
        message:
          error instanceof Error ? error.message : "Webhook queueing failed.",
      }),
    );
  }
});

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'",
        "https://challenges.cloudflare.com",
        "https://*.posthog.com",
      ],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      scriptSrc: [
        "'self'",
        // VitePress emits these two fixed, non-data-bearing startup snippets
        // for theme preference and macOS shortcut labels. Hashes keep the
        // help center functional without allowing arbitrary inline scripts.
        "'sha256-CUFLjg0/PrsMf8xbok429Fq66aDGe3lUN/QY4rcXnT8='",
        "'sha256-ng8W1FnGVqbzCCV1hV2EGXSMN/WlYnkoQZy8x1kkcsM='",
        // Vite's local React refresh preamble. This exact hash keeps
        // `npm run dev` usable without allowing arbitrary inline scripts.
        "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='",
        "https://challenges.cloudflare.com",
        "https://*.posthog.com",
        "https://static.cloudflareinsights.com",
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      frameSrc: [
        "https://challenges.cloudflare.com",
        "https://www.youtube.com",
        "https://player.vimeo.com",
        "https://docs.google.com",
      ],
      frameAncestors: [
        (context) => (context.req.path.startsWith("/embed/") ? "*" : "'none'"),
      ],
      baseUri: ["'self'"],
      formAction: [
        (context) =>
          context.req.path.startsWith("/embed/") ? "'none'" : "'self'",
      ],
      objectSrc: ["'none'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: false,
  }),
);

app.use("*", async (context, next) => {
  await next();
  if (context.req.path.startsWith("/embed/")) {
    context.res.headers.delete("x-frame-options");
  } else {
    context.header("x-frame-options", "SAMEORIGIN");
  }
});

app.get("/api/health", (context) =>
  context.json({
    status: "ok" as const,
    service: "programloom" as const,
    environment: context.env.APP_ENV,
    sourceCommit: context.env.RELEASE_COMMIT ?? "development",
    workerVersion: context.env.CF_VERSION_METADATA?.id ?? "development",
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
app.route("/api/reviews", reviewRoutes);
app.route("/api/speakers", speakerRoutes);
app.route("/api/agenda", agendaRoutes);
app.route("/api/widgets", widgetRoutes);
app.route("/api/crm", crmRoutes);
app.route("/api/integrations", integrationRoutes);
app.route("/api/content", contentRoutes);
app.route("/api/communications", communicationRoutes);
app.route("/api/calendar", calendarRoutes);
app.route("/api/control-room", controlRoomRoutes);
app.route("/api/submission-workspace", submissionWorkspaceRoutes);
app.route("/api/event-templates", eventTemplateRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/review-routing", reviewRoutingRoutes);
app.route("/api/developer", developerAdminRoutes);
app.route("/api/v1", developerApiRoutes);
app.route("/api/oauth", developerOauthRoutes);
app.get("/.well-known/oauth-authorization-server", (context) =>
  context.json(oauthMetadata(context.env)),
);

app.get("/embed/:publicKey", async (context) => {
  const assetUrl = new URL("/index.html", context.req.url);
  const asset = await context.env.ASSETS.fetch(new Request(assetUrl));
  const headers = new Headers(asset.headers);
  headers.set("cache-control", "no-cache, no-store, must-revalidate");
  return new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
});

app.get("/help", (context) => context.redirect("/help/", 308));

app.get("/assets/*", async (context) => {
  const asset = await context.env.ASSETS.fetch(context.req.raw);
  if (!asset.ok || asset.headers.get("content-type")?.includes("text/html")) {
    return new Response("Asset not found.", {
      status: 404,
      headers: {
        "cache-control": "no-cache, no-store, must-revalidate",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
  return asset;
});

app.notFound(async (context) => {
  if (context.req.path.startsWith("/api/")) {
    return context.json(
      {
        error: {
          code: "not_found",
          message: "The requested API route does not exist.",
        },
        requestId: context.get("requestId"),
      },
      404,
    );
  }
  let asset = await context.env.ASSETS.fetch(context.req.raw);
  if (context.req.path.startsWith("/help/") && !asset.ok) {
    const path = context.req.path;
    const cleanHelpAssetPath = path.endsWith("/")
      ? `${path}index.html`
      : /\.[a-z0-9]+$/i.test(path)
        ? null
        : `${path}.html`;
    if (cleanHelpAssetPath) {
      const cleanHelpAssetUrl = new URL(cleanHelpAssetPath, context.req.url);
      const cleanHelpAsset = await context.env.ASSETS.fetch(
        new Request(cleanHelpAssetUrl, {
          headers: context.req.raw.headers,
        }),
      );
      if (cleanHelpAsset.ok) asset = cleanHelpAsset;
    }
  }
  if (context.req.path.startsWith("/help/") && !asset.ok) {
    const helpNotFoundUrl = new URL("/help/404.html", context.req.url);
    const helpNotFound = await context.env.ASSETS.fetch(
      new Request(helpNotFoundUrl),
    );
    const headers = new Headers(helpNotFound.headers);
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
    return new Response(helpNotFound.body, {
      status: 404,
      headers,
    });
  }
  if (!asset.ok) {
    const applicationUrl = new URL("/index.html", context.req.url);
    const application = await context.env.ASSETS.fetch(
      new Request(applicationUrl),
    );
    const headers = new Headers(application.headers);
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
    return new Response(application.body, {
      status: application.status,
      statusText: application.statusText,
      headers,
    });
  }
  const headers = new Headers(asset.headers);
  if (headers.get("content-type")?.includes("text/html"))
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
  return new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
});

app.onError((error, context) => {
  if (error instanceof HttpError) {
    return context.json(
      {
        error: { code: error.code, message: error.message },
        requestId: context.get("requestId"),
      },
      error.status,
    );
  }
  console.error(
    JSON.stringify({
      level: "error",
      service: "programloom",
      operation: "request",
      requestId: context.get("requestId"),
      method: context.req.method,
      path: context.req.path,
      message: error.message,
    }),
  );
  return context.json(
    {
      error: { code: "internal_error", message: "Something went wrong." },
      requestId: context.get("requestId"),
    },
    500,
  );
});

type ProgramLoomJob =
  | { kind: "airtable_outbox"; outboxId: string }
  | { kind: "airtable_reconcile" }
  | { kind: "developer_webhook"; deliveryId: string }
  | CommunicationJob;

const worker: ExportedHandler<Env, ProgramLoomJob> = {
  fetch: app.fetch,
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        if (message.body.kind === "communication_send") {
          const result = await processCommunication(env, message.body);
          if (result.retry) message.retry({ delaySeconds: 60 });
          else message.ack();
          continue;
        } else if (message.body.kind === "developer_webhook") {
          const result = await processDeveloperWebhook(
            env,
            message.body.deliveryId,
          );
          if (result.retry)
            message.retry({ delaySeconds: result.delaySeconds });
          else message.ack();
          continue;
        } else if (message.body.kind === "airtable_outbox")
          await processAirtableOutbox(env, message.body.outboxId);
        else {
          await beginAirtableReconciliation(env);
          try {
            await reconcileAirtableOrganizations(env);
          } finally {
            await finishAirtableReconciliation(env);
          }
        }
        message.ack();
      } catch (error) {
        logOperationalError(error, {
          operation: "queue",
          jobKind: message.body.kind,
          messageId: message.id,
        });
        message.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(event, env, context) {
    context.waitUntil(
      observeOperation("airtable_outbox_dispatch", () =>
        dispatchPendingAirtableOutbox(env),
      ),
    );
    context.waitUntil(
      observeOperation("communication_dispatch", () =>
        dispatchScheduledCommunications(env),
      ),
    );
    context.waitUntil(
      observeOperation("developer_webhook_dispatch", () =>
        dispatchPendingDeveloperWebhooks(env),
      ),
    );
    context.waitUntil(
      observeOperation("overdue_task_notifications_and_email_dispatch", () =>
        createOverdueTaskNotificationsAndDispatchEmails(env),
      ),
    );
    if (event.cron === "0 3 * * *") {
      context.waitUntil(
        observeOperation("airtable_webhook_refresh", () =>
          refreshAirtableWebhook(env),
        ),
      );
      context.waitUntil(
        observeOperation("workspace_ephemeral_cleanup", () =>
          cleanupEphemeralWorkspaceState(env),
        ),
      );
      context.waitUntil(
        observeOperation("notification_retention_cleanup", () =>
          cleanupNotificationRetention(env),
        ),
      );
    }
  },
};

async function observeOperation<T>(operation: string, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    logOperationalError(error, { operation });
    throw error;
  }
}

function logOperationalError(error: unknown, fields: Record<string, string>) {
  console.error(
    JSON.stringify({
      level: "error",
      service: "programloom",
      ...fields,
      message:
        error instanceof Error ? error.message : "Operational task failed.",
    }),
  );
}

export default worker;
