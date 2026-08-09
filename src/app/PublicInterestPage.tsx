import { Turnstile } from "@marsidev/react-turnstile";
import { ArrowRight, CheckCircle2, LoaderCircle, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

type InterestField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "url" | "select";
  required: boolean;
  options: string[];
};

type InterestForm = {
  title: string;
  description: string | null;
  mode: "speakers_only" | "sessions_and_speakers";
  organizationName: string;
  opensAt: string | null;
  closesAt: string | null;
  fields: InterestField[];
  accepting: boolean;
};

export function PublicInterestPage() {
  const { organizationSlug, formSlug } = useParams();
  const [form, setForm] = useState<InterestForm>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    fetch(`/api/crm/public/${organizationSlug}/${formSlug}`)
      .then(async (response) => {
        const result = (await response.json()) as {
          form?: InterestForm;
          error?: { message?: string };
        };
        if (!response.ok || !result.form) {
          throw new Error(
            result.error?.message ?? "This interest form is unavailable.",
          );
        }
        setForm(result.form);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [formSlug, organizationSlug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setError(undefined);
    const values = new FormData(event.currentTarget);
    const answers = Object.fromEntries(
      form.fields.map((field) => [
        field.key,
        values.get(`answer-${field.key}`),
      ]),
    );
    try {
      const response = await fetch(
        `/api/crm/public/${organizationSlug}/${formSlug}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: values.get("firstName"),
            lastName: values.get("lastName"),
            email: values.get("email"),
            company: values.get("company") || null,
            jobTitle: values.get("jobTitle") || null,
            bio: values.get("bio") || null,
            sessionTitle: values.get("sessionTitle") || null,
            sessionAbstract: values.get("sessionAbstract") || null,
            answers,
            turnstileToken,
          }),
        },
      );
      const result = (await response.json()) as {
        message?: string;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          result.error?.message ?? "We could not submit your interest.",
        );
      setSuccess(
        result.message ?? "Thanks — the program team received your interest.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "We could not submit your interest.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="interest-public-state">
        <LoaderCircle className="spin" /> Loading interest form…
      </main>
    );
  }
  if (!form) {
    return (
      <main className="interest-public-state">
        <h1>Form unavailable</h1>
        <p>{error}</p>
        <Link to="/">ProgramLoom home</Link>
      </main>
    );
  }
  if (success) {
    return (
      <main className="interest-public-state interest-success">
        <CheckCircle2 />
        <p className="kicker">Interest received</p>
        <h1>Thank you for raising your hand.</h1>
        <p>{success}</p>
        <span>
          {form.organizationName} will follow up using the email you provided.
        </span>
      </main>
    );
  }

  return (
    <div className="interest-public-shell">
      <header>
        <Link className="wordmark" to="/">
          <span className="mark">PL</span>ProgramLoom
        </Link>
        <span>Hosted for {form.organizationName}</span>
      </header>
      <main>
        <aside>
          <div className="eyebrow">
            <Sparkles size={14} /> Year-round speaker network
          </div>
          <h1>{form.title}</h1>
          <p>{form.description}</p>
          <dl>
            <div>
              <dt>What happens next</dt>
              <dd>
                Your profile enters the program team’s speaker network for
                thoughtful, relevant opportunities.
              </dd>
            </div>
            <div>
              <dt>Your information</dt>
              <dd>
                Used only by {form.organizationName} to evaluate and coordinate
                speaking opportunities.
              </dd>
            </div>
          </dl>
        </aside>
        <section className="interest-public-card">
          {!form.accepting ? (
            <div className="interest-closed">
              <h2>This form is currently closed.</h2>
              <p>
                Please check back later or contact {form.organizationName}{" "}
                directly.
              </p>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="interest-form-heading">
                <p className="kicker">Tell us about yourself</p>
                <h2>Speaker profile</h2>
                <p>Required fields are marked with an asterisk.</p>
              </div>
              <fieldset>
                <legend>Identity</legend>
                <div className="form-columns">
                  <label>
                    First name *
                    <input
                      name="firstName"
                      autoComplete="given-name"
                      required
                    />
                  </label>
                  <label>
                    Last name *
                    <input
                      name="lastName"
                      autoComplete="family-name"
                      required
                    />
                  </label>
                  <label>
                    Email *
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label>
                    Company
                    <input name="company" autoComplete="organization" />
                  </label>
                  <label className="wide">
                    Job title
                    <input name="jobTitle" autoComplete="organization-title" />
                  </label>
                </div>
                <label>
                  Short bio
                  <textarea name="bio" rows={5} maxLength={5000} />
                </label>
              </fieldset>
              {form.mode === "sessions_and_speakers" && (
                <fieldset>
                  <legend>Session idea</legend>
                  <label>
                    Working title *
                    <input name="sessionTitle" required maxLength={240} />
                  </label>
                  <label>
                    Abstract *
                    <textarea
                      name="sessionAbstract"
                      required
                      rows={7}
                      maxLength={10000}
                    />
                  </label>
                </fieldset>
              )}
              {form.fields.length > 0 && (
                <fieldset>
                  <legend>More about you</legend>
                  {form.fields.map((field) => (
                    <label key={field.key}>
                      {field.label}
                      {field.required ? " *" : ""}
                      {field.type === "textarea" ? (
                        <textarea
                          name={`answer-${field.key}`}
                          rows={5}
                          required={field.required}
                        />
                      ) : field.type === "select" ? (
                        <select
                          name={`answer-${field.key}`}
                          required={field.required}
                        >
                          <option value="">Choose one</option>
                          {field.options.map((option) => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          name={`answer-${field.key}`}
                          type={field.type === "url" ? "url" : "text"}
                          required={field.required}
                        />
                      )}
                    </label>
                  ))}
                </fieldset>
              )}
              {siteKey && (
                <Turnstile
                  siteKey={siteKey}
                  onSuccess={setTurnstileToken}
                  onExpire={() => setTurnstileToken(undefined)}
                  options={{ theme: "light" }}
                />
              )}
              {error && (
                <div className="form-status form-status-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button button-large"
                disabled={submitting || Boolean(siteKey && !turnstileToken)}
              >
                {submitting ? "Submitting…" : "Share my interest"}
                {!submitting && <ArrowRight size={18} />}
              </button>
              <p className="interest-privacy">
                By submitting, you agree that {form.organizationName} may store
                this profile and contact you about relevant speaking
                opportunities.
              </p>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
