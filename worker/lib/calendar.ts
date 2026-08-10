export type CalendarSnapshot = {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  eventName: string;
  eventTimezone: string;
  sessionTitle: string;
  description: string;
  startsAt: string;
  endsAt: string;
  roomName?: string | null;
  venueName?: string | null;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
  createdAt: string;
};

export function calendarUid(agendaItemId: string) {
  return `${agendaItemId}@programloom.com`;
}

export async function calendarMaterialHash(
  input: Omit<CalendarSnapshot, "sequence" | "method" | "createdAt">,
) {
  const value = JSON.stringify(input, Object.keys(input).sort());
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function renderCalendarMessage(snapshot: CalendarSnapshot) {
  const location = [snapshot.roomName, snapshot.venueName]
    .filter(Boolean)
    .join(", ");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//ProgramLoom//Participant Calendar//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${snapshot.method}`,
    `X-WR-TIMEZONE:${escapeText(snapshot.eventTimezone)}`,
    "BEGIN:VEVENT",
    `UID:${escapeText(snapshot.uid)}`,
    `SEQUENCE:${snapshot.sequence}`,
    `DTSTAMP:${utcDate(snapshot.createdAt)}`,
    `DTSTART:${utcDate(snapshot.startsAt)}`,
    `DTEND:${utcDate(snapshot.endsAt)}`,
    `SUMMARY:${escapeText(snapshot.sessionTitle)}`,
    `DESCRIPTION:${escapeText(`${snapshot.description}\n\n${snapshot.eventName}`)}`,
    `LOCATION:${escapeText(location)}`,
    `ORGANIZER;CN=${quoteParameter(snapshot.organizerName)}:mailto:${snapshot.organizerEmail}`,
    `ATTENDEE;CN=${quoteParameter(snapshot.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${snapshot.attendeeEmail}`,
    snapshot.method === "CANCEL" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}

export function safeCalendarFilename(title: string) {
  const stem = title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return `${stem || "program-session"}.ics`;
}

function utcDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid calendar date.");
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function quoteParameter(value: string) {
  return `"${value.replace(/["\r\n]/g, "")}"`;
}

function foldLine(line: string) {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let current = "";
  for (const character of line) {
    const next = `${current}${character}`;
    if (encoder.encode(next).length > 75) {
      folded.push(current);
      current = ` ${character}`;
    } else {
      current = next;
    }
  }
  folded.push(current);
  return folded;
}
