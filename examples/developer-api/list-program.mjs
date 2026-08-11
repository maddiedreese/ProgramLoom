const token = process.env.PROGRAMLOOM_TOKEN;
const baseUrl =
  process.env.PROGRAMLOOM_API_URL ?? "https://app.programloom.com/api/v1";

if (!token) {
  console.error(
    "Set PROGRAMLOOM_TOKEN to a restricted token created in ProgramLoom Workspace settings.",
  );
  process.exitCode = 1;
} else {
  const request = async (path) => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { "x-access-token": token },
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        `${body.error?.code ?? response.status}: ${body.error?.message ?? "Request failed"} (${body.requestId ?? "no request id"})`,
      );
    return body;
  };

  const { data: events } = await request("/events?limit=25");
  for (const event of events) {
    const { data: sessions } = await request(
      `/sessions?eventId=${encodeURIComponent(event.id)}&sort=title&limit=100`,
    );
    console.log(`${event.name}: ${sessions.length} sessions`);
    for (const session of sessions) console.log(`  - ${session.title}`);
  }
}
