import { describe, expect, it } from "vitest";
import app from "./index";

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
    expect(body).toMatchObject({ status: "ok", service: "programloom", environment: "test" });
  });

  it("uses a structured error envelope for unknown API routes", async () => {
    const response = await app.request("/api/not-real", {}, env);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("serves front-end assets for application routes", async () => {
    const response = await app.request("/register", {}, env);
    expect(await response.text()).toBe("asset");
  });

  it("protects event workspace routes before database access", async () => {
    const response = await app.request("/api/events/00000000-0000-4000-8000-000000000003", {}, env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "authentication_required" } });
  });
});
