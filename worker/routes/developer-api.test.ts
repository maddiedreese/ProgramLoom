import { describe, expect, it } from "vitest";
import type { ApiTokenContext } from "../lib/developerPlatform";
import {
  activeApiTokenLookupSql,
  cancelledSessionAgendaStatement,
  requireScope,
} from "./developer-api";

describe("developer API session lifecycle", () => {
  it("cancels placements using a schema-valid draft state", () => {
    const observed: { sql?: string; bindings?: unknown[] } = {};
    const db = {
      prepare(sql: string) {
        observed.sql = sql;
        return {
          bind(...bindings: unknown[]) {
            observed.bindings = bindings;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    cancelledSessionAgendaStatement(
      db,
      "submission-1",
      "2026-08-12T12:00:00.000Z",
    );

    expect(observed.sql).toContain("status='draft'");
    expect(observed.sql).not.toContain("status='cancelled'");
    expect(observed.sql).toContain("version=version+1");
    expect(observed.bindings).toEqual([
      "2026-08-12T12:00:00.000Z",
      "2026-08-12T12:00:00.000Z",
      "submission-1",
    ]);
  });
});

describe("developer API token authorization", () => {
  const token: ApiTokenContext = {
    id: "token-id",
    organizationId: "organization-id",
    name: "Read-only production verifier",
    scopes: ["read:events"],
    eventIds: ["event-id"],
    hidePii: true,
    createdBy: "user-id",
  };

  it("rejects revoked and expired tokens in the persisted lookup", () => {
    expect(activeApiTokenLookupSql).toContain("revoked_at IS NULL");
    expect(activeApiTokenLookupSql).toContain(
      "expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP",
    );
  });

  it("allows a required scope and rejects a missing scope without data", () => {
    expect(() => requireScope(token, "read:events")).not.toThrow();
    expect(() => requireScope(token, "write:events")).toThrowError(
      expect.objectContaining({
        status: 403,
        code: "insufficient_scope",
      }),
    );
  });
});
