import { AlertTriangle, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

export function SubmissionEditActionPage() {
  const [error, setError] = useState<string>();
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setError("This private action link is incomplete.");
      return;
    }
    void fetch("/api/public/actions/submission-edit/resolve", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          destination?: string;
          editToken?: string;
          error?: { message?: string };
        };
        if (!response.ok || !result.destination || !result.editToken)
          throw new Error(
            result.error?.message ?? "This private action link is unavailable.",
          );
        window.location.replace(
          `${result.destination}#edit=${encodeURIComponent(result.editToken)}`,
        );
      })
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "This private action link is unavailable.",
        ),
      );
  }, []);

  return (
    <main className="loading-page" aria-busy={!error}>
      {error ? (
        <>
          <AlertTriangle aria-hidden="true" />
          <h1>We could not open this proposal.</h1>
          <p>{error}</p>
          <a className="button" href="/cfp">
            Browse open calls
          </a>
        </>
      ) : (
        <>
          <LoaderCircle className="spin" aria-hidden="true" />
          Opening your private proposal…
        </>
      )}
    </main>
  );
}
