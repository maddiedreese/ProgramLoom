import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  authenticatedUserOrNull,
  requireEventRole,
  type EventRole,
} from "./authz";

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

function roleApp() {
  const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
  app.get("/organizer/:eventId", async (context) => {
    const access = await requireEventRole(
      context,
      context.req.param("eventId"),
      ["owner", "admin"],
    );
    return context.json({ role: access.role });
  });
  app.get("/reviewer/:eventId", async (context) => {
    const access = await requireEventRole(
      context,
      context.req.param("eventId"),
      ["reviewer"],
    );
    return context.json({ role: access.role });
  });
  app.get("/speaker/:eventId", async (context) => {
    const access = await requireEventRole(
      context,
      context.req.param("eventId"),
      ["speaker"],
    );
    return context.json({ role: access.role });
  });
  app.onError((error, context) => {
    const status =
      typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : 500;
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "internal_error";
    return context.json({ error: { code } }, status as 401 | 403 | 404 | 500);
  });
  return app;
}

function roleEnv(input: {
  session?: "valid" | "expired";
  role?: EventRole;
  organizationId?: string;
}) {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          first: () => {
            if (sql.includes("FROM auth_sessions"))
              return Promise.resolve(input.session === "valid" ? user : null);
            if (sql.includes("FROM events e"))
              return Promise.resolve(
                input.role
                  ? {
                      role: input.role,
                      organizationId:
                        input.organizationId ??
                        "00000000-0000-4000-8000-000000000010",
                    }
                  : null,
              );
            throw new Error(`Unexpected authorization query: ${sql}`);
          },
        };
      },
    },
  } as unknown as Env;
}

const eventId = "00000000-0000-4000-8000-000000000020";
const signedIn = { headers: { cookie: "programloom_session=valid-session" } };

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

describe("event authorization identity matrix", () => {
  it("returns 401 without authentication and for an expired session", async () => {
    const anonymous = await roleApp().request(
      `/organizer/${eventId}`,
      {},
      roleEnv({}),
    );
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toEqual({
      error: { code: "authentication_required" },
    });

    const expired = await roleApp().request(
      `/organizer/${eventId}`,
      signedIn,
      roleEnv({ session: "expired" }),
    );
    expect(expired.status).toBe(401);
    await expect(expired.json()).resolves.toEqual({
      error: { code: "session_expired" },
    });
  });

  it.each(["owner", "admin"] as const)(
    "allows an authorized %s in the owning organization and event",
    async (role) => {
      const response = await roleApp().request(
        `/organizer/${eventId}`,
        signedIn,
        roleEnv({ session: "valid", role }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ role });
    },
  );

  it("uses a non-enumerating 404 for another organization or event", async () => {
    for (const inaccessibleId of [
      eventId,
      "00000000-0000-4000-8000-000000000099",
    ]) {
      const response = await roleApp().request(
        `/organizer/${inaccessibleId}`,
        signedIn,
        roleEnv({ session: "valid" }),
      );
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toContain("event_not_found");
      expect(body).not.toMatch(/ProgramLoom Summit|DevFlow|speaker@example/i);
    }
  });

  it("allows only a connected reviewer into the reviewer workspace", async () => {
    const assigned = await roleApp().request(
      `/reviewer/${eventId}`,
      signedIn,
      roleEnv({ session: "valid", role: "reviewer" }),
    );
    expect(assigned.status).toBe(200);

    const unassigned = await roleApp().request(
      `/reviewer/${eventId}`,
      signedIn,
      roleEnv({ session: "valid" }),
    );
    expect(unassigned.status).toBe(404);

    const speaker = await roleApp().request(
      `/reviewer/${eventId}`,
      signedIn,
      roleEnv({ session: "valid", role: "speaker" }),
    );
    expect(speaker.status).toBe(403);
  });

  it("allows only a connected speaker into the speaker workspace", async () => {
    const connected = await roleApp().request(
      `/speaker/${eventId}`,
      signedIn,
      roleEnv({ session: "valid", role: "speaker" }),
    );
    expect(connected.status).toBe(200);

    const unrelated = await roleApp().request(
      `/speaker/${eventId}`,
      signedIn,
      roleEnv({ session: "valid" }),
    );
    expect(unrelated.status).toBe(404);

    const reviewer = await roleApp().request(
      `/speaker/${eventId}`,
      signedIn,
      roleEnv({ session: "valid", role: "reviewer" }),
    );
    expect(reviewer.status).toBe(403);
  });
});
