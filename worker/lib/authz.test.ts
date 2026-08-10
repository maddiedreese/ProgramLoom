import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { authenticatedUserOrNull } from "./authz";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "speaker@example.test",
  name: "Priya Speaker",
};

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
  app.get("/session", async (context) =>
    context.json({ user: await authenticatedUserOrNull(context) }),
  );
  return app;
}

describe("optional authenticated session", () => {
  it("returns null without requiring database access for an anonymous request", async () => {
    const response = await testApp().request("/session", {}, {} as Env);
    await expect(response.json()).resolves.toEqual({ user: null });
  });

  it("returns the persisted user for a valid signed-in session", async () => {
    const env = {
      DB: {
        prepare(sql: string) {
          expect(sql).toContain("FROM auth_sessions");
          return {
            bind() {
              return this;
            },
            first: () => Promise.resolve(user),
          };
        },
      },
    } as unknown as Env;
    const response = await testApp().request(
      "/session",
      { headers: { cookie: "programloom_session=valid-session" } },
      env,
    );
    await expect(response.json()).resolves.toEqual({ user });
  });
});
