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
import { useLocation, useParams } from "react-router-dom";
import { MutationResultPanel } from "./MutationResultPanel";

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
type Submitter = {
  name: string;
  email: string;
  organization: string;
  participantRole?: "coauthor" | "presenter" | "panelist" | "discussant";
};
type CurrentSubmission = {
  id: string;
  status: string;
  answers: Record<string, unknown>;
  submitter: Submitter;
  coSubmitters: Submitter[];
  locked: boolean;
};
type OwnedSubmission = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
};

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

export function validateCfpFieldValue(field: Field, value: unknown) {
  const missing =
    value === undefined ||
    value === null ||
    value === "" ||
    value === false ||
    (Array.isArray(value) && value.length === 0);
  if (missing) return undefined;
  if (
    field.fieldType === "email" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
  )
    return "Enter a valid email address.";
  if (field.fieldType === "url") {
    try {
      new URL(String(value));
    } catch {
      return "Enter a complete URL.";
    }
  }
  if (field.fieldType === "number" && !Number.isFinite(Number(value)))
    return "Enter a valid number.";
  if (
    field.fieldType === "select" &&
    field.options &&
    !field.options.includes(String(value))
  )
    return "Choose one of the available options.";
  if (
    field.fieldType === "multiselect" &&
    field.options &&
    (!Array.isArray(value) ||
      value.some((item) => !field.options?.includes(String(item))))
  )
    return "Choose only available options.";
  return undefined;
}

function fieldGuidance(field: Field) {
  if (field.description) return field.description;
  if (field.fieldType === "url")
    return "Include the complete link, beginning with https://.";
  if (field.fieldType === "multiselect")
    return "Choose every option that applies to this proposal.";
  if (field.fieldType === "select")
    return "Choose the single option that best fits this proposal.";
  if (field.fieldType === "textarea")
    return "Give reviewers enough specific context to evaluate this response.";
  return "This answer helps the program team review and prepare your proposal.";
}

export function PublicCfpPage() {
  const params = useParams();
  const location = useLocation();
  const apiPath = `/api/public/cfp/${params.organizationSlug}/${params.eventSlug}/${params.formSlug}`;
  const requestedSubmissionId = new URLSearchParams(location.search).get(
    "submission",
  );
  const definitionPath = requestedSubmissionId
    ? `${apiPath}?submission=${encodeURIComponent(requestedSubmissionId)}`
    : apiPath;
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
  const [submissionId, setSubmissionId] = useState<string>();
  const [coSubmitters, setCoSubmitters] = useState<Submitter[]>([]);
  const [status, setStatus] = useState<string>();
  const [ownedSubmissions, setOwnedSubmissions] = useState<OwnedSubmission[]>(
    [],
  );
  const [locked, setLocked] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [signedIn, setSignedIn] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [currentSection, setCurrentSection] = useState(0);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string;

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => response.json())
      .then(
        (result: {
          user?: { id: string; name: string; email: string } | null;
        }) => {
          setSignedIn(Boolean(result.user));
          if (result.user)
            setSubmitter((current) => ({
              ...current,
              name: current.name || result.user!.name,
              email: current.email || result.user!.email,
            }));
        },
      )
      .catch(() => setSignedIn(false))
      .finally(() => setSessionChecked(true));
  }, []);

  useEffect(() => {
    setLoading(true);
    setSubmissionId(undefined);
    setEditToken(undefined);
    setStatus(undefined);
    setAnswers({});
    setCoSubmitters([]);
    setCurrentSection(0);
    setLocked(false);
    api<{
      form: PublicForm;
      fields: Field[];
      conditions: Condition[];
      currentSubmission?: CurrentSubmission;
      ownedSubmissions?: OwnedSubmission[];
    }>(definitionPath)
      .then(async (result) => {
        setForm(result.form);
        setFields(result.fields);
        setConditions(result.conditions);
        setOwnedSubmissions(result.ownedSubmissions ?? []);
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
                coSubmitters: Submitter[];
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
            setCoSubmitters(preview.submission.coSubmitters ?? []);
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
        else if (result.currentSubmission) {
          setSubmissionId(result.currentSubmission.id);
          setStatus(result.currentSubmission.status);
          setAnswers(result.currentSubmission.answers);
          setSubmitter(result.currentSubmission.submitter);
          setCoSubmitters(result.currentSubmission.coSubmitters);
          setLocked(result.currentSubmission.locked);
          setFeedback({
            kind: "success",
            message:
              result.currentSubmission.status === "draft"
                ? "Your saved draft is ready to continue."
                : result.currentSubmission.locked
                  ? "This proposal is read-only because its editing window has closed. You can still start another proposal."
                  : result.currentSubmission.status === "accepted" ||
                      result.currentSubmission.status === "declined"
                    ? "The organizer's decision remains recorded. You may still update proposal or co-presenter details until editing closes."
                    : "Your submitted proposal is open for updates until the CFP closes or the organizer's earlier editing deadline.",
          });
        }
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [apiPath, definitionPath, location.hash, location.search]);

  const requiresSecurityCheck = Boolean(siteKey && !signedIn);

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

  function startAnotherProposal() {
    setSubmissionId(undefined);
    setEditToken(undefined);
    setStatus(undefined);
    setAnswers({});
    setCoSubmitters([]);
    window.history.replaceState(null, "", window.location.pathname);
    setFeedback({
      kind: "success",
      message:
        "New proposal started. Your earlier proposal remains submitted and unchanged.",
    });
    window.requestAnimationFrame(() =>
      document.getElementById("main-content")?.scrollIntoView(),
    );
  }

  async function save(event: FormEvent, action: "draft" | "submit") {
    event.preventDefault();
    setFeedback(undefined);
    setFieldErrors({});
    if (action === "submit") {
      const errors: Record<string, string> = {};
      if (submitter.name.trim().length < 2)
        errors["submitter-name"] = "Enter your full name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitter.email.trim()))
        errors["submitter-email"] = "Enter a valid email address.";
      for (const field of fields.filter(
        (candidate) => isVisible(candidate) && isRequired(candidate),
      )) {
        const value = answers[field.fieldKey];
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          value === false ||
          (Array.isArray(value) && value.length === 0)
        )
          errors[field.fieldKey] = `${field.label} is required.`;
      }
      for (const field of fields.filter((candidate) => isVisible(candidate))) {
        const validationError = validateCfpFieldValue(
          field,
          answers[field.fieldKey],
        );
        if (validationError) errors[field.fieldKey] = validationError;
      }
      if (Object.keys(errors).length) {
        setFieldErrors(errors);
        setFeedback({
          kind: "error",
          message: "Complete the highlighted fields before submitting.",
        });
        window.requestAnimationFrame(() => {
          document.getElementById(Object.keys(errors)[0])?.focus();
        });
        return;
      }
    }
    setBusy(true);
    try {
      const result = await api<{
        submission: { id: string; status: string };
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
          submissionId,
          coSubmitters: coSubmitters.filter(
            (person) => person.name.trim() || person.email.trim(),
          ),
          turnstileToken,
        }),
      });
      setEditToken(result.editToken);
      setSubmissionId(result.submission.id);
      setStatus(result.submission.status);
      setOwnedSubmissions((current) => [
        {
          id: result.submission.id,
          title: String(
            answers.session_title ?? answers.title ?? "Untitled draft",
          ),
          status: result.submission.status,
          updatedAt: new Date().toISOString(),
        },
        ...current.filter((proposal) => proposal.id !== result.submission.id),
      ]);
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
      window.requestAnimationFrame(() => {
        const firstInvalid = Object.keys(typed.fields ?? {})[0];
        const target = firstInvalid
          ? document.getElementById(firstInvalid)
          : document.getElementById("cfp-feedback");
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus();
      });
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

  if (loading || !sessionChecked)
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
  const formSections = (["welcome", "session", "speaker", "custom"] as const)
    .map((key) => ({
      key,
      fields: fields.filter(
        (field) => field.section === key && isVisible(field),
      ),
    }))
    .filter((section) => section.fields.length > 0);
  const sectionCount = 2 + formSections.length;
  const requiredFieldItems = fields.filter(
    (field) => isVisible(field) && isRequired(field),
  );
  const pairedCoSubmitters = coSubmitters.filter(
    (person) => person.name.trim() || person.email.trim(),
  );
  const totalRequiredItems =
    2 + requiredFieldItems.length + pairedCoSubmitters.length * 2;
  const completedRequiredItems =
    (submitter.name.trim().length >= 2 ? 1 : 0) +
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitter.email.trim()) ? 1 : 0) +
    requiredFieldItems.filter((field) => {
      const value = answers[field.fieldKey];
      return (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        value !== false &&
        (!Array.isArray(value) || value.length > 0) &&
        !validateCfpFieldValue(field, value)
      );
    }).length +
    pairedCoSubmitters.reduce(
      (count, person) =>
        count +
        (person.name.trim().length >= 2 ? 1 : 0) +
        (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim()) ? 1 : 0),
      0,
    );

  function validateCurrentSection() {
    const errors: Record<string, string> = {};
    if (currentSection === 0) {
      if (submitter.name.trim().length < 2)
        errors["submitter-name"] = "Enter your full name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitter.email.trim()))
        errors["submitter-email"] = "Enter a valid email address.";
    } else if (currentSection === 1) {
      coSubmitters.forEach((person, index) => {
        if (!person.name.trim() && !person.email.trim()) return;
        if (person.name.trim().length < 2)
          errors[`co-presenter-name-${index}`] =
            "Enter the co-presenter's full name.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim()))
          errors[`co-presenter-email-${index}`] =
            "Enter a valid co-presenter email address.";
      });
    } else {
      for (const field of formSections[currentSection - 2]?.fields ?? []) {
        const value = answers[field.fieldKey];
        const missing =
          value === undefined ||
          value === null ||
          value === "" ||
          value === false ||
          (Array.isArray(value) && value.length === 0);
        if (isRequired(field) && missing)
          errors[field.fieldKey] = `${field.label} is required.`;
        else {
          const validationError = validateCfpFieldValue(field, value);
          if (validationError) errors[field.fieldKey] = validationError;
        }
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setFeedback({
        kind: "error",
        message: "Complete this section before continuing.",
      });
      window.requestAnimationFrame(() =>
        document.getElementById(Object.keys(errors)[0])?.focus(),
      );
      return false;
    }
    setFeedback(undefined);
    return true;
  }

  function continueToNextSection() {
    if (!validateCurrentSection()) return;
    setCurrentSection((section) => Math.min(section + 1, sectionCount - 1));
    window.requestAnimationFrame(() =>
      document.getElementById("cfp-section-progress")?.scrollIntoView?.(),
    );
  }
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
        {signedIn && (
          <a className="text-link" href="/app#my-proposals-title">
            View all my submissions
          </a>
        )}
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
            <strong>{form.timezone}</strong>
          </div>
        </section>
        {feedback && (
          <div id="cfp-feedback">
            <MutationResultPanel
              feedback={feedback}
              nextAction={{
                label: "Review your proposals",
                href: `${window.location.pathname}#your-proposals-title`,
              }}
            />
          </div>
        )}
        {signedIn && ownedSubmissions.length > 0 && (
          <section
            className="public-submission-next"
            aria-labelledby="your-proposals-title"
          >
            <div>
              <strong id="your-proposals-title">Your proposals</strong>
              <span>
                Open any saved draft or submitted proposal. Each proposal is
                kept separately.
              </span>
            </div>
            <div className="public-proposal-links">
              {ownedSubmissions.map((proposal) => (
                <a
                  key={proposal.id}
                  className={proposal.id === submissionId ? "active" : ""}
                  aria-current={
                    proposal.id === submissionId ? "page" : undefined
                  }
                  href={`${window.location.pathname}?submission=${encodeURIComponent(proposal.id)}`}
                >
                  <strong>{proposal.title || "Untitled draft"}</strong>
                  <span>
                    {proposal.status === "draft" ? "Draft" : "Submitted"} ·
                    updated{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                    }).format(new Date(proposal.updatedAt))}
                  </span>
                </a>
              ))}
            </div>
            <button
              type="button"
              className="button button-ghost"
              onClick={startAnotherProposal}
            >
              Start a separate proposal
            </button>
          </section>
        )}
        {status === "pending" && !locked && (
          <section
            className="public-submission-next"
            aria-label="Proposal saved"
          >
            <div>
              <strong>This proposal is submitted.</strong>
              <span>
                Update it below, or begin a separate proposal without changing
                this one.
              </span>
            </div>
            <button
              type="button"
              className="button button-ghost"
              onClick={startAnotherProposal}
            >
              Start another proposal
            </button>
            <a className="button" href="/app#my-proposals-title">
              View all my submissions
            </a>
          </section>
        )}
        {locked ? (
          <section className="public-locked">
            <LockKeyhole size={30} />
            <h2>This proposal is read-only.</h2>
            <p>
              The organizer has closed the proposal editing window. Your saved
              proposal and its decision are unchanged.
            </p>
            <div className="public-form-actions">
              <button
                type="button"
                className="button button-ghost"
                onClick={startAnotherProposal}
              >
                Start another proposal
              </button>
              <a className="button" href="/app#my-proposals-title">
                View all my submissions
              </a>
            </div>
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
            noValidate
            onSubmit={(event) => save(event, "submit")}
          >
            <div
              className="cfp-section-progress"
              id="cfp-section-progress"
              aria-live="polite"
            >
              <div>
                <strong>
                  Section {currentSection + 1} of {sectionCount}
                </strong>
                <span>
                  {completedRequiredItems} of {totalRequiredItems} required
                  items completed
                </span>
              </div>
              <progress value={currentSection + 1} max={sectionCount}>
                Section {currentSection + 1} of {sectionCount}
              </progress>
              <progress value={completedRequiredItems} max={totalRequiredItems}>
                {completedRequiredItems} of {totalRequiredItems} required items
                completed
              </progress>
            </div>
            <section hidden={currentSection !== 0}>
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
                  <small>
                    Use the name the program team should use when contacting
                    you.
                  </small>
                  <input
                    id="submitter-name"
                    aria-describedby={
                      fieldErrors["submitter-name"]
                        ? "submitter-name-error"
                        : undefined
                    }
                    aria-invalid={Boolean(fieldErrors["submitter-name"])}
                    value={submitter.name}
                    onChange={(event) =>
                      setSubmitter((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                  {fieldErrors["submitter-name"] && (
                    <span id="submitter-name-error" className="field-error">
                      {fieldErrors["submitter-name"]}
                    </span>
                  )}
                </label>
                <label>
                  Email address
                  <small>
                    Your confirmation and private proposal edit link are sent
                    here.
                  </small>
                  <input
                    id="submitter-email"
                    aria-describedby={
                      fieldErrors["submitter-email"]
                        ? "submitter-email-error"
                        : undefined
                    }
                    aria-invalid={Boolean(fieldErrors["submitter-email"])}
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
                  {fieldErrors["submitter-email"] && (
                    <span id="submitter-email-error" className="field-error">
                      {fieldErrors["submitter-email"]}
                    </span>
                  )}
                </label>
                <label className="wide">
                  Organization <small>Optional</small>
                  <small>
                    Share the company, community, or independent affiliation you
                    want associated with this proposal.
                  </small>
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
            <section hidden={currentSection !== 1}>
              <div className="public-section-title">
                <span>02</span>
                <div>
                  <h2>Co-presenters</h2>
                  <p>
                    Add another speaker now so reviews, onboarding, scheduling,
                    and public profiles stay connected.
                  </p>
                </div>
              </div>
              <div className="public-field-grid">
                {coSubmitters.map((person, index) => (
                  <div className="wide co-presenter-row" key={index}>
                    <label>
                      Participant role
                      <small>
                        Choose how this person contributes to the proposed
                        session.
                      </small>
                      <select
                        value={person.participantRole ?? "coauthor"}
                        onChange={(event) =>
                          setCoSubmitters((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    participantRole: event.target.value as
                                      | "coauthor"
                                      | "presenter"
                                      | "panelist"
                                      | "discussant",
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="coauthor">Co-author</option>
                        <option value="presenter">Presenter</option>
                        <option value="panelist">Panelist</option>
                        <option value="discussant">Discussant</option>
                      </select>
                    </label>
                    <label>
                      Co-presenter name
                      <input
                        id={`co-presenter-name-${index}`}
                        aria-describedby={
                          fieldErrors[`co-presenter-name-${index}`]
                            ? `co-presenter-name-${index}-error`
                            : undefined
                        }
                        aria-invalid={Boolean(
                          fieldErrors[`co-presenter-name-${index}`],
                        )}
                        value={person.name}
                        onChange={(event) =>
                          setCoSubmitters((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          )
                        }
                        required={Boolean(person.email)}
                      />
                      <small>
                        Use the name the event should display and contact.
                      </small>
                      {fieldErrors[`co-presenter-name-${index}`] && (
                        <span
                          id={`co-presenter-name-${index}-error`}
                          className="field-error"
                        >
                          {fieldErrors[`co-presenter-name-${index}`]}
                        </span>
                      )}
                    </label>
                    <label>
                      Co-presenter email
                      <input
                        id={`co-presenter-email-${index}`}
                        aria-describedby={
                          fieldErrors[`co-presenter-email-${index}`]
                            ? `co-presenter-email-${index}-error`
                            : undefined
                        }
                        aria-invalid={Boolean(
                          fieldErrors[`co-presenter-email-${index}`],
                        )}
                        type="email"
                        value={person.email}
                        onChange={(event) =>
                          setCoSubmitters((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, email: event.target.value }
                                : item,
                            ),
                          )
                        }
                        required={Boolean(person.name)}
                      />
                      <small>
                        This address is used only for proposal and speaker
                        communication.
                      </small>
                      {fieldErrors[`co-presenter-email-${index}`] && (
                        <span
                          id={`co-presenter-email-${index}-error`}
                          className="field-error"
                        >
                          {fieldErrors[`co-presenter-email-${index}`]}
                        </span>
                      )}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setCoSubmitters((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Remove co-presenter
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() =>
                    setCoSubmitters((current) => [
                      ...current,
                      {
                        name: "",
                        email: "",
                        organization: "",
                        participantRole: "coauthor",
                      },
                    ])
                  }
                >
                  Add co-presenter
                </button>
              </div>
            </section>
            {formSections.map(
              ({ key: section, fields: sectionFields }, index) => {
                return (
                  <section key={section} hidden={currentSection !== index + 2}>
                    <div className="public-section-title">
                      <span>{String(index + 3).padStart(2, "0")}</span>
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
                          <small>{fieldGuidance(field)}</small>
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
            <div className="cfp-section-actions">
              {currentSection > 0 && (
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setCurrentSection((section) => section - 1)}
                >
                  Previous section
                </button>
              )}
              {currentSection < sectionCount - 1 && (
                <button
                  type="button"
                  className="button"
                  onClick={continueToNextSection}
                >
                  Continue to next section <ArrowRight size={18} />
                </button>
              )}
            </div>
            {currentSection === sectionCount - 1 && requiresSecurityCheck && (
              <Turnstile
                siteKey={siteKey}
                onSuccess={setTurnstileToken}
                onExpire={() => setTurnstileToken(undefined)}
                options={{ theme: "light" }}
              />
            )}
            {currentSection === sectionCount - 1 &&
              requiresSecurityCheck &&
              !turnstileToken && (
                <p className="security-check-status" role="status">
                  Complete the security check above to enable Save draft and
                  Submit proposal. Signed-in contributors skip this check.
                </p>
              )}
            {currentSection === sectionCount - 1 && (
              <aside
                className="cfp-after-submit"
                aria-labelledby="after-submit-title"
              >
                <h2 id="after-submit-title">What happens after you submit</h2>
                <ol>
                  <li>
                    Your proposal is saved as submitted and the organizer can
                    review it.
                  </li>
                  <li>
                    You receive a confirmation and a private link for allowed
                    edits.
                  </li>
                  <li>
                    A decision can be staged later, but it is not communicated
                    until the organizer chooses Send decision.
                  </li>
                  <li>
                    If accepted, connected speaker and session records are
                    activated for onboarding and scheduling.
                  </li>
                </ol>
              </aside>
            )}
            {currentSection === sectionCount - 1 && (
              <div className="public-form-actions">
                {(submissionId || editToken) && (
                  <button
                    type="button"
                    className="button button-ghost button-large"
                    onClick={startAnotherProposal}
                  >
                    Start another proposal
                  </button>
                )}
                {form.allowDrafts && status !== "pending" && (
                  <button
                    type="button"
                    className="button button-ghost button-large"
                    onClick={(event) => save(event, "draft")}
                    disabled={
                      busy || (requiresSecurityCheck && !turnstileToken)
                    }
                  >
                    <Save size={17} /> Save draft
                  </button>
                )}
                <button
                  className="button button-large"
                  disabled={busy || (requiresSecurityCheck && !turnstileToken)}
                >
                  {busy
                    ? "Saving…"
                    : status === "pending"
                      ? "Update proposal"
                      : "Submit proposal"}
                  <ArrowRight size={18} />
                </button>
              </div>
            )}
            {currentSection === sectionCount - 1 && (
              <p className="privacy-note">
                <LockKeyhole size={13} /> Your answers are shared only with this
                event’s authorized program team and assigned reviewers.
              </p>
            )}
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
