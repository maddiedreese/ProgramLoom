import { describe, expect, it } from "vitest";
import { cancelCommunicationJobsStatement } from "./communications";

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
