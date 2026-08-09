import { describe, expect, it } from "vitest";
import {
  calendarMaterialHash,
  calendarUid,
  renderCalendarMessage,
  safeCalendarFilename,
} from "./calendar";

const base = {
  uid: calendarUid("session-1"),
  sequence: 2,
  method: "REQUEST" as const,
  eventName: "ProgramLoom Summit",
  eventTimezone: "America/Los_Angeles",
  sessionTitle: "Durable calendars, without duplicate invitations",
  description: "A standards-focused session.",
  startsAt: "2026-11-01T09:30:00-08:00",
  endsAt: "2026-11-01T10:15:00-08:00",
  roomName: "Room A",
  venueName: "Moscone Center",
  organizerName: "ProgramLoom",
  organizerEmail: "notifications@mail.programloom.com",
  attendeeName: "Maddie Speaker",
  attendeeEmail: "maddie@example.com",
  createdAt: "2026-08-09T22:00:00.000Z",
};

describe("participant calendar messages", () => {
  it("keeps a stable UID, sequence, UTC dates, and standards line endings", () => {
    const ics = renderCalendarMessage(base);
    expect(ics).toContain("METHOD:REQUEST\r\n");
    expect(ics).toContain("UID:session-1@programloom.com\r\n");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics).toContain("DTSTART:20261101T173000Z\r\n");
    expect(ics).toContain("X-WR-TIMEZONE:America/Los_Angeles\r\n");
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(
      ics
        .split("\r\n")
        .every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
  });

  it("renders cancellation and deterministic material identity", async () => {
    const cancelled = renderCalendarMessage({
      ...base,
      method: "CANCEL",
      sequence: 3,
    });
    expect(cancelled).toContain("METHOD:CANCEL\r\n");
    expect(cancelled).toContain("STATUS:CANCELLED\r\n");
    const material = { ...base };
    delete (material as Partial<typeof base>).sequence;
    delete (material as Partial<typeof base>).method;
    delete (material as Partial<typeof base>).createdAt;
    expect(await calendarMaterialHash(material)).toBe(
      await calendarMaterialHash(material),
    );
    expect(safeCalendarFilename("Hello / World!")).toBe("hello-world.ics");
  });
});
