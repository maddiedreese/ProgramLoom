import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  airtableRecoveryAction,
  isAirtableDeletionAudit,
  resolvedConflictCompactionSql,
  speakerTaskAssignmentSql,
  speakerTaskEntityParts,
  verifyAirtableWebhook,
} from "./airtable";

describe("Airtable deletion intent", () => {
  it("classifies deleted records and removed composite assignments as deletions", () => {
    expect(isAirtableDeletionAudit("speaker_task.deleted")).toBe(true);
    expect(isAirtableDeletionAudit("speaker_task.assignment_removed")).toBe(
      true,
    );
    expect(isAirtableDeletionAudit("speaker_task.updated")).toBe(false);
  });
});

describe("Airtable conflict recovery", () => {
  it("compacts an older resolved snapshot before resolving a repeated failure", () => {
    expect(resolvedConflictCompactionSql).toContain(
      "DELETE FROM integration_conflicts",
    );
    expect(resolvedConflictCompactionSql).toContain("status='resolved'");
    expect(resolvedConflictCompactionSql).toContain("organization_id=?");
    expect(resolvedConflictCompactionSql).toContain("entity_type=?");
    expect(resolvedConflictCompactionSql).toContain("entity_id=?");
  });

  it("converges stale queued upserts by deleting missing projections", () => {
    expect(airtableRecoveryAction(false)).toBe("delete");
    expect(airtableRecoveryAction(true)).toBe("upsert");
  });
});

describe("Airtable webhook verification", () => {
  it("accepts the matching Airtable HMAC and rejects altered payloads", async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const encodedSecret = btoa(String.fromCharCode(...secret));
    const body = JSON.stringify({ base: { id: "appProgramLoom" } });
    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    );
    const mac = `hmac-sha256=${[...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
    const env = { AIRTABLE_WEBHOOK_MAC_SECRET: encodedSecret } as Env;

    await expect(verifyAirtableWebhook(env, body, mac)).resolves.toBe(true);
    await expect(verifyAirtableWebhook(env, `${body} `, mac)).resolves.toBe(
      false,
    );
    await expect(verifyAirtableWebhook(env, body, undefined)).resolves.toBe(
      false,
    );
  });
});

describe("Airtable speaker task projection", () => {
  it("targets the composite assignment key without querying a missing id column", () => {
    expect(speakerTaskEntityParts("task-id:speaker-id")).toEqual({
      taskId: "task-id",
      speakerId: "speaker-id",
    });
    expect(speakerTaskEntityParts("task-id")).toEqual({
      taskId: "task-id",
      speakerId: null,
    });
    expect(speakerTaskAssignmentSql).toContain("a.task_id=?");
    expect(speakerTaskAssignmentSql).toContain("a.speaker_id=?");
    expect(speakerTaskAssignmentSql).not.toContain("a.id");
  });
});
