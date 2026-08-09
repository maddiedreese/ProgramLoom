import { ArrowRight, CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

type Invitation = { email: string; role: string; organizationName: string; eventName: string | null; expiresAt: string; needsName: boolean };

export function InvitePage() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  const [invitation, setInvitation] = useState<Invitation>();
  const [state, setState] = useState<"loading" | "ready" | "submitting" | "accepted" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) { setState("error"); setMessage("This invitation link is incomplete."); return; }
    fetch("/api/auth/invitations/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (response) => {
        const result = await response.json() as { invitation?: Invitation; error?: { message?: string } };
        if (!response.ok || !result.invitation) throw new Error(result.error?.message ?? "This invitation is unavailable.");
        setInvitation(result.invitation); setState("ready");
      })
      .catch((error: Error) => { setMessage(error.message); setState("error"); });
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState("submitting"); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name: data.get("name") || undefined }) });
      const result = await response.json() as { redirectTo?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "The invitation could not be accepted.");
      setState("accepted");
      window.setTimeout(() => window.location.assign(result.redirectTo ?? "/app"), 650);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The invitation could not be accepted."); setState("error"); }
  }

  return <main id="main-content" className="invite-page"><section className="invite-card">
    <a href="/" className="wordmark"><span aria-hidden="true" className="mark">PL</span>ProgramLoom</a>
    {state === "loading" && <div className="invite-state" aria-busy="true"><LoaderCircle className="spin" /><h1>Checking your invitation…</h1></div>}
    {state === "error" && <div className="invite-state"><ShieldCheck /><h1>Invitation unavailable</h1><p>{message}</p><a className="button button-large" href="/login">Go to sign in</a></div>}
    {state === "accepted" && <div className="invite-state"><CheckCircle2 /><h1>You’re in.</h1><p>Opening your ProgramLoom workspace…</p></div>}
    {(state === "ready" || state === "submitting") && invitation && <div className="invite-state"><p className="kicker">You’ve been invited</p><h1>Join {invitation.organizationName}</h1><p>Accept access as a <strong>{invitation.role}</strong>{invitation.eventName ? <> for <strong>{invitation.eventName}</strong></> : null}. This invitation was sent to {invitation.email}.</p>
      <form onSubmit={accept}>{invitation.needsName && <label>Full name<input name="name" autoComplete="name" minLength={2} required /></label>}<button className="button button-large" disabled={state === "submitting"}>{state === "submitting" ? "Joining…" : "Accept invitation"}<ArrowRight size={18} /></button></form>
      <small>Expires {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invitation.expiresAt))}</small>
    </div>}
  </section></main>;
}
