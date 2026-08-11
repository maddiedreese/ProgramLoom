import { Check, KeyRound, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

type Consent = {
  user: { name: string; email: string };
  client: { id: string; name: string };
  organizationId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  events: Array<{ id: string; name: string }>;
};

export function OAuthAuthorize() {
  const [consent, setConsent] = useState<Consent>();
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/oauth/authorize${window.location.search}`, {
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
          return undefined;
        }
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ?? "Authorization could not be opened.",
          );
        return body as Consent;
      })
      .then((body) => body && setConsent(body))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function decide(approve: boolean) {
    if (!consent) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/oauth/authorize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: consent.client.id,
          redirectUri: consent.redirectUri,
          scope: consent.scopes.join(" "),
          state: consent.state,
          codeChallenge: consent.codeChallenge,
          codeChallengeMethod: consent.codeChallengeMethod,
          eventIds,
          approve,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Authorization failed.");
      window.location.assign(body.redirect);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Authorization failed.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="oauth-consent-page">
      <section className="oauth-consent-card">
        <a className="wordmark" href="/">
          <span className="mark" aria-hidden="true">
            PL
          </span>{" "}
          ProgramLoom
        </a>
        {error ? (
          <div className="form-status form-status-error" role="alert">
            {error}
          </div>
        ) : !consent ? (
          <div className="loading-page">
            <LoaderCircle className="spin" /> Preparing secure authorization…
          </div>
        ) : (
          <>
            <KeyRound size={34} />
            <p className="kicker">Authorize an external application</p>
            <h1>{consent.client.name} wants access to ProgramLoom</h1>
            <p>
              Signed in as <strong>{consent.user.name}</strong> (
              {consent.user.email}). The application will return to{" "}
              <code>{new URL(consent.redirectUri).origin}</code>.
            </p>
            <h2>Requested access</h2>
            <ul>
              {consent.scopes.map((scope) => (
                <li key={scope}>
                  <Check size={15} /> {scope}
                </li>
              ))}
            </ul>
            <fieldset>
              <legend>Restrict access to selected events</legend>
              <p>
                Leave every event unchecked to allow all current and future
                events in this workspace.
              </p>
              {consent.events.map((event) => (
                <label className="check-row" key={event.id}>
                  <input
                    type="checkbox"
                    checked={eventIds.includes(event.id)}
                    onChange={(input) =>
                      setEventIds((current) =>
                        input.target.checked
                          ? [...current, event.id]
                          : current.filter((id) => id !== event.id),
                      )
                    }
                  />
                  <span>{event.name}</span>
                </label>
              ))}
            </fieldset>
            <div className="oauth-actions">
              <button
                className="button button-ghost"
                disabled={busy}
                onClick={() => void decide(false)}
              >
                <X size={16} /> Deny access
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => void decide(true)}
              >
                <Check size={16} /> Authorize application
              </button>
            </div>
            <small>
              ProgramLoom will issue a one-hour access token with PII hidden.
              You can revoke it from Workspace settings.
            </small>
          </>
        )}
      </section>
    </main>
  );
}
