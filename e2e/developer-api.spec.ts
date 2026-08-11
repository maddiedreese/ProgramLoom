import { expect, test } from "@playwright/test";

const token = process.env.PROGRAMLOOM_E2E_API_TOKEN;
const eventId = process.env.PROGRAMLOOM_E2E_EVENT_ID;

test.describe("versioned developer API", () => {
  test.skip(
    !token || !eventId,
    "Provide an ignored restricted API token and event id.",
  );

  const headers = { "x-access-token": token ?? "" };

  test("enforces token scope, event restriction, PII masking, and bounded reads", async ({
    request,
  }) => {
    const events = await request.get("/api/v1/events?limit=1", { headers });
    expect(events.ok()).toBeTruthy();
    expect(events.headers()["x-ratelimit-limit"]).toBeTruthy();
    const eventBody = await events.json();
    expect(eventBody.pagination.limit).toBe(1);
    expect(eventBody.data.map((item: { id: string }) => item.id)).toContain(
      eventId,
    );

    const sessions = await request.get(
      `/api/v1/sessions?eventId=${eventId}&limit=100&sort=title`,
      { headers },
    );
    expect(sessions.ok()).toBeTruthy();
    const sessionBody = await sessions.json();
    expect(sessionBody.data.length).toBeLessThanOrEqual(100);
    for (const session of sessionBody.data)
      expect(session.customFields).toEqual({});

    const contacts = await request.get("/api/v1/contacts?limit=25", {
      headers,
    });
    if (contacts.status() === 200)
      for (const contact of (await contacts.json()).data) {
        expect(contact.email).toBeNull();
        expect(contact.customFields).toEqual({});
      }

    const inaccessible = await request.get(
      "/api/v1/events/00000000-0000-4000-8000-000000000099",
      { headers },
    );
    expect(inaccessible.status()).toBe(404);
    expect(await inaccessible.json()).toMatchObject({
      error: { code: "event_not_found" },
      requestId: expect.any(String),
    });
  });

  test("serves the same authorization model through query and MCP", async ({
    request,
  }) => {
    const query = await request.post("/api/v1/query", {
      headers,
      data: {
        entity: "sessions",
        fields: ["id", "eventId", "title"],
        filters: { eventId },
        limit: 25,
      },
    });
    expect(query.ok()).toBeTruthy();
    for (const item of (await query.json()).data)
      expect(item.eventId).toBe(eventId);

    const mcp = await request.post("/api/v1/mcp", {
      headers,
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(mcp.ok()).toBeTruthy();
    expect((await mcp.json()).result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "list_events" }),
        expect.objectContaining({ name: "query_program" }),
      ]),
    );
  });
});
