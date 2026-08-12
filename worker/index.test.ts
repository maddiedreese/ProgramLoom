import { describe, expect, it } from "vitest";
import { app } from "./index";

const env = {
  APP_ENV: "test",
  APP_URL: "https://app.programloom.com",
  MARKETING_URL: "https://programloom.com",
  ASSETS: { fetch: () => Promise.resolve(new Response("asset")) },
};

describe("ProgramLoom Worker", () => {
  it("returns a typed health response and request id", async () => {
    const response = await app.request("/api/health", {}, env);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body).toMatchObject({
      status: "ok",
      service: "programloom",
      environment: "test",
      sourceCommit: "development",
      workerVersion: "development",
    });
  });

  it("uses a structured error envelope for unknown API routes", async () => {
    const response = await app.request("/api/not-real", {}, env);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("serves front-end assets for application routes", async () => {
    const response = await app.request("/register", {}, env);
    expect(await response.text()).toBe("asset");
  });

  it("returns the application recovery page with a real 404 for unknown browser routes", async () => {
    const response = await app.request(
      "/not-a-real-programloom-page",
      {},
      {
        ...env,
        ASSETS: {
          fetch: () =>
            Promise.resolve(
              new Response("<html>application shell</html>", {
                headers: { "content-type": "text/html; charset=utf-8" },
              }),
            ),
        },
      },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain("application shell");
  });

  it("returns a real 404 when the asset binding misses before loading the application shell", async () => {
    const response = await app.request(
      "/another-missing-programloom-page",
      {},
      {
        ...env,
        ASSETS: {
          fetch: (request: Request) =>
            Promise.resolve(
              new URL(request.url).pathname === "/index.html"
                ? new Response("<html>application shell</html>", {
                    headers: { "content-type": "text/html; charset=utf-8" },
                  })
                : new Response("missing", { status: 404 }),
            ),
        },
      },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain("application shell");
  });

  it.each([
    "/app/events/event-1/control-room",
    "/c/example/event/cfp",
    "/embed/public-key",
  ])(
    "keeps known browser route %s successful when assets return the application shell",
    async (path) => {
      const response = await app.request(
        path,
        {},
        {
          ...env,
          ASSETS: {
            fetch: () =>
              Promise.resolve(
                new Response("<html>application shell</html>", {
                  headers: { "content-type": "text/html; charset=utf-8" },
                }),
              ),
          },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("application shell");
    },
  );

  it("keeps missing help pages inside the help center", async () => {
    const requestedPaths: string[] = [];
    const response = await app.request(
      "/help/not-real",
      {},
      {
        ...env,
        ASSETS: {
          fetch: (request: Request) => {
            const path = new URL(request.url).pathname;
            requestedPaths.push(path);
            return Promise.resolve(
              path === "/help/404.html"
                ? new Response("help not found")
                : new Response("missing", { status: 404 }),
            );
          },
        },
      },
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("help not found");
    expect(requestedPaths).toEqual([
      "/help/not-real",
      "/help/not-real.html",
      "/help/404.html",
    ]);
  });

  it("serves generated help pages through clean human-facing URLs", async () => {
    const requestedPaths: string[] = [];
    const response = await app.request(
      "/help/getting-started",
      {},
      {
        ...env,
        ASSETS: {
          fetch: (request: Request) => {
            const path = new URL(request.url).pathname;
            requestedPaths.push(path);
            return Promise.resolve(
              path === "/help/getting-started.html"
                ? new Response("getting started", {
                    headers: { "content-type": "text/html" },
                  })
                : new Response("missing", { status: 404 }),
            );
          },
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("getting started");
    expect(requestedPaths).toEqual([
      "/help/getting-started",
      "/help/getting-started.html",
    ]);
  });

  it("normalizes the help entry point to its canonical trailing slash", async () => {
    const response = await app.request("/help", {}, env);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/help/");
  });

  it("does not serve the application shell for a missing hashed asset", async () => {
    const response = await app.request(
      "/assets/stale-chunk.js",
      {},
      {
        ...env,
        ASSETS: {
          fetch: () =>
            Promise.resolve(
              new Response("<html>shell</html>", {
                headers: { "content-type": "text/html" },
              }),
            ),
        },
      },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("overrides immutable caching on an asset-layer 404", async () => {
    const response = await app.request(
      "/assets/missing.js",
      {},
      {
        ...env,
        ASSETS: {
          fetch: () =>
            Promise.resolve(
              new Response(null, {
                status: 404,
                headers: { "cache-control": "public, max-age=31536000" },
              }),
            ),
        },
      },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("allows public widgets to be framed without weakening application routes", async () => {
    const widget = await app.request("/embed/public-key", {}, env);
    expect(widget.status).toBe(200);
    await expect(widget.clone().text()).resolves.toBe("asset");
    expect(widget.headers.get("content-security-policy")).toContain(
      "frame-ancestors *",
    );
    expect(widget.headers.get("x-frame-options")).toBeNull();

    const application = await app.request("/register", {}, env);
    expect(application.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(application.headers.get("content-security-policy")).toContain(
      "sha256-CUFLjg0/PrsMf8xbok429Fq66aDGe3lUN/QY4rcXnT8=",
    );
    expect(application.headers.get("content-security-policy")).toContain(
      "sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk=",
    );
    expect(application.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("protects event workspace routes before database access", async () => {
    const response = await app.request(
      "/api/events/00000000-0000-4000-8000-000000000003",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects speaker CRM routes before database access", async () => {
    const response = await app.request(
      "/api/crm/organizations/00000000-0000-4000-8000-000000000003/contacts",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("does not disclose an unconfigured Airtable webhook", async () => {
    const response = await app.request(
      "/api/integrations/airtable/webhook/not-a-secret",
      { method: "POST", body: "{}" },
      env,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "webhook_not_found" },
    });
  });

  it("protects Airtable integration status before database access", async () => {
    const response = await app.request(
      "/api/integrations/organizations/00000000-0000-4000-8000-000000000003/airtable",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects content administration before database access", async () => {
    const response = await app.request(
      "/api/content/admin/events/00000000-0000-4000-8000-000000000003",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects organizer headshots before storage access", async () => {
    const response = await app.request(
      "/api/speakers/admin/events/00000000-0000-4000-8000-000000000003/speakers/00000000-0000-4000-8000-000000000004/headshot",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects the event communications center before database access", async () => {
    const response = await app.request(
      "/api/communications/events/00000000-0000-4000-8000-000000000003",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects the Organizer Control Room before database access", async () => {
    const response = await app.request(
      "/api/control-room/events/00000000-0000-4000-8000-000000000003",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects the configurable submission workspace before database access", async () => {
    const response = await app.request(
      "/api/submission-workspace/events/00000000-0000-4000-8000-000000000003/meta",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects reviewer routing before database access", async () => {
    const response = await app.request(
      "/api/review-routing/events/00000000-0000-4000-8000-000000000003",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects developer settings and the versioned API before database access", async () => {
    const admin = await app.request(
      "/api/developer/organizations/00000000-0000-4000-8000-000000000003",
      {},
      env,
    );
    expect(admin.status).toBe(401);

    const api = await app.request("/api/v1/events", {}, env);
    expect(api.status).toBe(401);
    await expect(api.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("publishes developer documentation without requiring product access", async () => {
    const openapi = await app.request("/api/v1/openapi.json", {}, env);
    expect(openapi.status).toBe(200);
    await expect(openapi.json()).resolves.toMatchObject({
      openapi: "3.1.0",
      info: { title: "ProgramLoom Developer API" },
    });

    const docs = await app.request("/api/v1/docs", {}, env);
    expect(docs.status).toBe(200);
  });

  it("protects reusable event templates before database access", async () => {
    const response = await app.request(
      "/api/event-templates/organizations/00000000-0000-4000-8000-000000000003",
      {},
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects organizer-wide search before database access", async () => {
    const response = await app.request("/api/search?q=proposal", {}, env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("protects the notification center before database access", async () => {
    const response = await app.request("/api/notifications", {}, env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("does not disclose an unconfigured Resend webhook", async () => {
    const response = await app.request(
      "/api/communications/resend/webhook",
      { method: "POST", body: "{}" },
      env,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "webhook_not_found" },
    });
  });
});
