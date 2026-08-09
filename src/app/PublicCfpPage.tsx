import { Turnstile } from "@marsidev/react-turnstile";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Save,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams } from "react-router-dom";

type PublicForm = {
  name: string;
  description: string | null;
  eventName: string;
  organizationName: string;
  timezone: string;
  primaryColor: string;
  opensAt: string | null;
  closesAt: string | null;
  editClosesAt: string | null;
  allowDrafts: boolean;
  availability: "upcoming" | "open" | "closed";
};
type Field = {
  id: string;
  section: string;
  fieldType: string;
  fieldKey: string;
  label: string;
  description?: string | null;
  placeholder?: string | null;
  required: boolean;
  options?: string[];
  position: number;
};
type Condition = {
  sourceFieldId: string;
  operator: string;
  compareValue?: unknown;
  targetFieldId: string;
  action: "show" | "hide" | "require";
};
type Submitter = { name: string; email: string; organization: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const result = (await response.json()) as T & {
    error?: { message?: string; fields?: Record<string, string> };
  };
  if (!response.ok) {
    const error = new Error(
      result.error?.message ?? "The request could not be completed.",
    ) as Error & { fields?: Record<string, string> };
    error.fields = result.error?.fields;
    throw error;
  }
  return result;
}

function conditionMatches(
  operator: string,
  actual: unknown,
  expected: unknown,
) {
  if (operator === "is_checked") return actual === true;
  if (operator === "equals")
    return String(actual ?? "") === String(expected ?? "");
  if (operator === "not_equals")
    return String(actual ?? "") !== String(expected ?? "");
  if (operator === "contains")
    return Array.isArray(actual)
      ? actual.map(String).includes(String(expected))
      : String(actual ?? "").includes(String(expected ?? ""));
  if (operator === "greater_than") return Number(actual) > Number(expected);
  if (operator === "less_than") return Number(actual) < Number(expected);
  return false;
}

export function PublicCfpPage() {
  const params = useParams();
  const apiPath = `/api/public/cfp/${params.organizationSlug}/${params.eventSlug}/${params.formSlug}`;
  const [form, setForm] = useState<PublicForm>();
  const [fields, setFields] = useState<Field[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitter, setSubmitter] = useState<Submitter>({
    name: "",
    email: "",
    organization: "",
  });
  const [editToken, setEditToken] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [locked, setLocked] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string;

  useEffect(() => {
    api<{ form: PublicForm; fields: Field[]; conditions: Condition[] }>(apiPath)
      .then(async (result) => {
        setForm(result.form);
        setFields(result.fields);
        setConditions(result.conditions);
        const token =
          new URLSearchParams(window.location.hash.slice(1)).get("edit") ??
          undefined;
        if (token)
          try {
            const preview = await api<{
              submission: {
                status: string;
                answers: Record<string, unknown>;
                submitter: Submitter;
                locked: boolean;
              };
            }>(`${apiPath}/submissions/preview`, {
              method: "POST",
              body: JSON.stringify({ editToken: token }),
            });
            setEditToken(token);
            setStatus(preview.submission.status);
            setAnswers(preview.submission.answers);
            setSubmitter({
              ...preview.submission.submitter,
              organization: preview.submission.submitter.organization ?? "",
            });
            setLocked(preview.submission.locked);
          } catch (error) {
            setFeedback({
              kind: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "This private edit link is invalid.",
            });
          }
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [apiPath]);

  const fieldById = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields],
  );
  function isVisible(field: Field) {
    const showRules = conditions.filter(
      (condition) =>
        condition.targetFieldId === field.id && condition.action === "show",
    );
    const hidden = conditions.some(
      (condition) =>
        condition.targetFieldId === field.id &&
        condition.action === "hide" &&
        conditionMatches(
          condition.operator,
          answers[fieldById.get(condition.sourceFieldId)?.fieldKey ?? ""],
          condition.compareValue,
        ),
    );
    return (
      !hidden &&
      (!showRules.length ||
        showRules.some((condition) =>
          conditionMatches(
            condition.operator,
            answers[fieldById.get(condition.sourceFieldId)?.fieldKey ?? ""],
            condition.compareValue,
          ),
        ))
    );
  }
  function isRequired(field: Field) {
    return (
      field.required ||
      conditions.some(
        (condition) =>
          condition.targetFieldId === field.id &&
          condition.action === "require" &&
          conditionMatches(
            condition.operator,
            answers[fieldById.get(condition.sourceFieldId)?.fieldKey ?? ""],
            condition.compareValue,
          ),
      )
    );
  }
  function setAnswer(key: string, value: unknown) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function save(event: FormEvent, action: "draft" | "submit") {
    event.preventDefault();
    setBusy(true);
    setFeedback(undefined);
    setFieldErrors({});
    try {
      const result = await api<{
        submission: { status: string };
        editToken: string;
        emailQueued: boolean;
        emailSent: boolean;
      }>(`${apiPath}/submissions`, {
        method: "POST",
        body: JSON.stringify({
          submitter,
          answers,
          action,
          editToken,
          turnstileToken,
        }),
      });
      setEditToken(result.editToken);
      setStatus(result.submission.status);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}#edit=${encodeURIComponent(result.editToken)}`,
      );
      setFeedback({
        kind: "success",
        message:
          action === "draft"
            ? "Draft saved. This private browser link can reopen it."
            : result.emailQueued
              ? "Proposal submitted. Your confirmation and private edit link are queued for delivery."
              : result.emailSent
                ? "Proposal submitted. A confirmation and private edit link are in your inbox."
                : "Proposal submitted. Save this private URL; the confirmation remains visible to organizers for retry.",
      });
    } catch (error) {
      const typed = error as Error & { fields?: Record<string, string> };
      setFieldErrors(typed.fields ?? {});
      setFeedback({ kind: "error", message: typed.message });
      document
        .getElementById("cfp-feedback")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      setBusy(false);
    }
  }

  function renderField(field: Field) {
    const common = {
      id: field.fieldKey,
      name: field.fieldKey,
      required: isRequired(field),
      "aria-describedby": fieldErrors[field.fieldKey]
        ? `${field.fieldKey}-error`
        : undefined,
    };
    const value = answers[field.fieldKey];
    if (field.fieldType === "textarea")
      return (
        <textarea
          {...common}
          rows={5}
          placeholder={field.placeholder ?? undefined}
          value={String(value ?? "")}
          onChange={(event) => setAnswer(field.fieldKey, event.target.value)}
        />
      );
    if (field.fieldType === "select")
      return (
        <select
          {...common}
          value={String(value ?? "")}
          onChange={(event) => setAnswer(field.fieldKey, event.target.value)}
        >
          <option value="">Choose one…</option>
          {field.options?.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    if (field.fieldType === "multiselect")
      return (
        <div className="public-options">
          {field.options?.map((option) => (
            <label className="option-check" key={option}>
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(option)}
                onChange={(event) => {
                  const current = Array.isArray(value) ? value : [];
                  setAnswer(
                    field.fieldKey,
                    event.target.checked
                      ? [...current, option]
                      : current.filter((item) => item !== option),
                  );
                }}
              />{" "}
              {option}
            </label>
          ))}
        </div>
      );
    if (field.fieldType === "checkbox")
      return (
        <label className="option-check">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) =>
              setAnswer(field.fieldKey, event.target.checked)
            }
          />{" "}
          Yes
        </label>
      );
    const inputType = ["email", "url", "number", "date"].includes(
      field.fieldType,
    )
      ? field.fieldType
      : "text";
    return (
      <input
        {...common}
        type={inputType}
        placeholder={field.placeholder ?? undefined}
        value={String(value ?? "")}
        onChange={(event) =>
          setAnswer(
            field.fieldKey,
            inputType === "number"
              ? event.target.value === ""
                ? ""
                : Number(event.target.value)
              : event.target.value,
          )
        }
      />
    );
  }

  if (loading)
    return (
      <main className="public-cfp-loading" aria-busy="true">
        <LoaderCircle className="spin" /> Loading call for proposals…
      </main>
    );
  if (!form)
    return (
      <main className="public-cfp-loading">
        <FileText size={30} />
        <h1>Call for proposals unavailable</h1>
        {feedback && <p>{feedback.message}</p>}
      </main>
    );
  const unavailable = form.availability !== "open";
  return (
    <div
      className="public-cfp-shell"
      style={{ "--event-color": form.primaryColor } as CSSProperties}
    >
      <header className="public-cfp-header">
        <a className="wordmark" href="/">
          <span aria-hidden="true" className="mark">
            PL
          </span>
          ProgramLoom
        </a>
        <span>{form.organizationName}</span>
      </header>
      <main id="main-content" className="public-cfp-main">
        <section className="public-cfp-intro">
          <p className="kicker">{form.eventName}</p>
          <h1>{form.name}</h1>
          {form.description && <p>{form.description}</p>}
          <div className="deadline-row">
            <CalendarClock size={17} />
            {form.availability === "upcoming"
              ? `Opens ${form.opensAt ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: form.timezone }).format(new Date(form.opensAt)) : "soon"}`
              : form.availability === "closed"
                ? "Submissions are closed"
                : form.closesAt
                  ? `Submit by ${new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: form.timezone }).format(new Date(form.closesAt))}`
                  : "Submissions are open"}
          </div>
        </section>
        {feedback && (
          <div
            id="cfp-feedback"
            className={`form-status form-status-${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        )}
        {locked ? (
          <section className="public-locked">
            <LockKeyhole size={30} />
            <h2>This proposal is read-only.</h2>
            <p>
              The organizer has closed editing or recorded a final decision.
            </p>
          </section>
        ) : unavailable ? (
          <section className="public-locked">
            <CalendarClock size={30} />
            <h2>
              {form.availability === "upcoming"
                ? "Submissions have not opened yet."
                : "The deadline has passed."}
            </h2>
            <p>
              Contact the event team if you believe you reached this page in
              error.
            </p>
          </section>
        ) : (
          <form
            className="public-cfp-form"
            onSubmit={(event) => save(event, "submit")}
          >
            <section>
              <div className="public-section-title">
                <span>01</span>
                <div>
                  <h2>About you</h2>
                  <p>
                    We’ll use this for confirmation and program communication.
                  </p>
                </div>
              </div>
              <div className="public-field-grid">
                <label>
                  Full name
                  <input
                    value={submitter.name}
                    onChange={(event) =>
                      setSubmitter((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Email address
                  <input
                    type="email"
                    value={submitter.email}
                    onChange={(event) =>
                      setSubmitter((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label className="wide">
                  Organization <small>Optional</small>
                  <input
                    value={submitter.organization}
                    onChange={(event) =>
                      setSubmitter((current) => ({
                        ...current,
                        organization: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </section>
            {(["welcome", "session", "speaker", "custom"] as const).map(
              (section, index) => {
                const sectionFields = fields.filter(
                  (field) => field.section === section && isVisible(field),
                );
                if (!sectionFields.length) return null;
                return (
                  <section key={section}>
                    <div className="public-section-title">
                      <span>{String(index + 2).padStart(2, "0")}</span>
                      <div>
                        <h2>
                          {section === "session"
                            ? "Your proposal"
                            : section === "speaker"
                              ? "Speaker details"
                              : section === "welcome"
                                ? "Before you begin"
                                : "A few more details"}
                        </h2>
                      </div>
                    </div>
                    <div className="public-field-grid">
                      {sectionFields.map((field) => (
                        <label
                          className={
                            ["textarea", "multiselect", "checkbox"].includes(
                              field.fieldType,
                            )
                              ? "wide"
                              : ""
                          }
                          key={field.id}
                          htmlFor={field.fieldKey}
                        >
                          {field.label}
                          {isRequired(field) && <em>Required</em>}
                          {field.description && (
                            <small>{field.description}</small>
                          )}
                          {renderField(field)}
                          {fieldErrors[field.fieldKey] && (
                            <span
                              id={`${field.fieldKey}-error`}
                              className="field-error"
                            >
                              {fieldErrors[field.fieldKey]}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </section>
                );
              },
            )}
            {siteKey && (
              <Turnstile
                siteKey={siteKey}
                onSuccess={setTurnstileToken}
                onExpire={() => setTurnstileToken(undefined)}
                options={{ theme: "light" }}
              />
            )}
            <div className="public-form-actions">
              {form.allowDrafts && status !== "pending" && (
                <button
                  type="button"
                  className="button button-ghost button-large"
                  onClick={(event) => save(event, "draft")}
                  disabled={busy || Boolean(siteKey && !turnstileToken)}
                >
                  <Save size={17} /> Save draft
                </button>
              )}
              <button
                className="button button-large"
                disabled={busy || Boolean(siteKey && !turnstileToken)}
              >
                {busy
                  ? "Saving…"
                  : status === "pending"
                    ? "Update proposal"
                    : "Submit proposal"}
                <ArrowRight size={18} />
              </button>
            </div>
            <p className="privacy-note">
              <LockKeyhole size={13} /> Your answers are shared only with this
              event’s authorized program team and assigned reviewers.
            </p>
          </form>
        )}
        {status === "pending" && (
          <div className="submission-marker">
            <CheckCircle2 size={17} /> Submitted
          </div>
        )}
      </main>
      <footer>
        <span>Powered by ProgramLoom</span>
        <a href="/">Build your program</a>
      </footer>
    </div>
  );
}
