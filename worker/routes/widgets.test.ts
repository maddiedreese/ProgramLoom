import { describe, expect, it } from "vitest";
import {
  publicAgendaSessionEligibility,
  publicSpeakerAgendaJoin,
  renderWidgetEmbedScript,
  widgetRemovalStatements,
} from "./widgets";

describe("widget deletion", () => {
  it("renders a safe JavaScript embed without document injection", () => {
    const script = renderWidgetEmbedScript("agenda-safe-key");
    expect(script).toContain("document.currentScript");
    expect(script).toContain('createElement("iframe")');
    expect(script).toContain("https://programloom.com/embed/agenda-safe-key");
    expect(script).not.toContain("document.write");
    expect(script).not.toContain("innerHTML");
  });

  it("limits public speaker data to the published, non-cancelled program", () => {
    expect(publicSpeakerAgendaJoin).toContain("status='published'");
    expect(publicSpeakerAgendaJoin).toContain("cancelled_at IS NULL");
    expect(publicSpeakerAgendaJoin).toContain("submission_id=s.id");
    expect(publicSpeakerAgendaJoin).toContain("event_id=s.event_id");
  });

  it("excludes withdrawn sessions from public agenda payloads", () => {
    expect(publicAgendaSessionEligibility).toContain("s.status='accepted'");
    expect(publicAgendaSessionEligibility).toContain("cs.status='approved'");
    expect(publicAgendaSessionEligibility).toContain("a.submission_id IS NULL");
  });
  it("scopes the delete and retains an audited before state", () => {
    const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const record = { sql, bindings: [] as unknown[] };
        prepared.push(record);
        return {
          bind(...bindings: unknown[]) {
            record.bindings = bindings;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    const statements = widgetRemovalStatements(db, {
      widgetId: "widget-1",
      eventId: "event-1",
      organizationId: "organization-1",
      actorUserId: "user-1",
      requestId: "request-1",
      before: {
        name: "Old sessions widget",
        widgetType: "sessions",
        publicKey: "sessions-old",
      },
    });

    expect(statements).toHaveLength(2);
    expect(prepared[0]).toMatchObject({
      sql: "DELETE FROM widget_configs WHERE id=? AND event_id=?",
      bindings: ["widget-1", "event-1"],
    });
    expect(prepared[1].bindings).toContain("widget.deleted");
    expect(prepared[1].bindings).toContain("widget_config");
    expect(prepared[1].bindings).toContain("widget-1");
    expect(prepared[1].bindings).toContain(
      JSON.stringify({
        name: "Old sessions widget",
        widgetType: "sessions",
        publicKey: "sessions-old",
      }),
    );
  });
});
