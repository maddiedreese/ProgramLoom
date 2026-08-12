import { describe, expect, it, vi } from "vitest";
import {
  cancelCommunicationJobsStatement,
  enqueueCommunication,
  prepareCommunicationStatement,
} from "./communications";

describe("communication job cancellation", () => {
  it("cancels every active or exhausted delivery job for the message", () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(value: string) {
        sql = value;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    cancelCommunicationJobsStatement(db, "message-1");

    expect(sql).toContain("status='cancelled'");
    expect(sql).toContain("'retrying','exhausted'");
    expect(sql).toContain("job_kind='communication_send'");
    expect(bindings).toEqual(["message-1"]);
  });
});

describe("communication idempotency and queue retries", () => {
  it("gives identical communication requests one durable database identity", () => {
    let sql = "";
    let bindings: unknown[] = [];
    const db = {
      prepare(value: string) {
        sql = value;
        return {
          bind(...values: unknown[]) {
            bindings = values;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    prepareCommunicationStatement(db, {
      id: "message-1",
      organizationId: "organization-1",
      eventId: "event-1",
      category: "decision_acceptance",
      recipientEmail: "controlled@example.com",
      subject: "Decision update",
      bodyHtml: "<p>Update</p>",
      bodyText: "Update",
      idempotencyKey: "same-request",
      correlationId: "correlation-1",
    });

    expect(sql).toContain("ON CONFLICT(idempotency_key) DO NOTHING");
    expect(bindings).toContain("same-request");
    expect(bindings).toContain("correlation-1");
  });

  it.each(["sent", "delivered", "bounced", "cancelled"])(
    "does not enqueue or send a duplicate after the message reaches %s",
    async (status) => {
      const send = vi.fn();
      const db = {
        prepare() {
          return {
            bind() {
              return this;
            },
            first: () =>
              Promise.resolve({
                id: "message-1",
                organizationId: "organization-1",
                eventId: "event-1",
                status,
                scheduledFor: null,
                correlationId: "correlation-1",
              }),
          };
        },
      } as unknown as D1Database;

      await expect(
        enqueueCommunication({ DB: db, JOBS: { send } } as never, "message-1"),
      ).resolves.toEqual({ queued: false, terminal: true });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("reuses the active queue job instead of dispatching a second copy", async () => {
    const send = vi.fn();
    let query = 0;
    const db = {
      prepare() {
        query += 1;
        return {
          bind() {
            return this;
          },
          first: () =>
            Promise.resolve(
              query === 1
                ? {
                    id: "message-1",
                    organizationId: "organization-1",
                    eventId: "event-1",
                    status: "queued",
                    scheduledFor: null,
                    correlationId: "correlation-1",
                  }
                : { id: "existing-job" },
            ),
        };
      },
    } as unknown as D1Database;

    await expect(
      enqueueCommunication({ DB: db, JOBS: { send } } as never, "message-1"),
    ).resolves.toEqual({
      queued: false,
      alreadyQueued: true,
      jobId: "existing-job",
    });
    expect(send).not.toHaveBeenCalled();
  });
});
