type PostHogClient = (typeof import("posthog-js"))["default"];
let posthogClient: Promise<PostHogClient | undefined> | undefined;

export function initializeTelemetry() {
  const posthogKey = import.meta.env.VITE_POSTHOG_KEY as string;
  const posthogHost = import.meta.env.VITE_POSTHOG_HOST as string;
  if (posthogKey && posthogHost) {
    posthogClient = import("posthog-js").then(({ default: posthog }) => {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        defaults: "2025-05-24",
        capture_pageview: "history_change",
        capture_pageleave: true,
        autocapture: false,
        disable_session_recording: true,
        person_profiles: "identified_only",
        request_batching: false,
        persistence: "localStorage+cookie",
        secure_cookie: import.meta.env.PROD,
      });
      return posthog;
    });
  }
}

export function captureProductEvent(
  name: string,
  properties?: Record<string, unknown>,
) {
  void posthogClient?.then((posthog) => {
    if (posthog && !posthog.has_opted_out_capturing())
      posthog.capture(name, properties);
  });
}
