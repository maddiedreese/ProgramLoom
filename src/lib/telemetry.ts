type TelemetryConfig = { key: string; host: string };

let telemetry: TelemetryConfig | undefined;
const anonymousIdKey = "programloom_analytics_id";
const privateProperty =
  /query|email|phone|name|title|message|content|recipient|token|secret|password/i;

function anonymousId() {
  try {
    const existing = window.localStorage.getItem(anonymousIdKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(anonymousIdKey, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function privacySafeProductProperties(
  properties: Record<string, unknown> = {},
) {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key, value]) =>
        !privateProperty.test(key) &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"),
    ),
  );
}

export function initializeTelemetry() {
  const key = import.meta.env.VITE_POSTHOG_KEY as string;
  const configuredHost = import.meta.env.VITE_POSTHOG_HOST as string;
  if (!key || !configuredHost) return;
  try {
    const host = new URL(configuredHost);
    if (host.protocol !== "https:") return;
    telemetry = { key, host: host.href.replace(/\/$/, "") };
  } catch {
    telemetry = undefined;
  }
}

export function captureProductEvent(
  name: string,
  properties?: Record<string, unknown>,
) {
  if (!telemetry || navigator.doNotTrack === "1") return;
  void fetch(`${telemetry.host}/capture/`, {
    method: "POST",
    credentials: "omit",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: telemetry.key,
      event: name,
      properties: {
        distinct_id: anonymousId(),
        $process_person_profile: false,
        ...privacySafeProductProperties(properties),
      },
    }),
  }).catch(() => undefined);
}
