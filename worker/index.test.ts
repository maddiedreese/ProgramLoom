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
