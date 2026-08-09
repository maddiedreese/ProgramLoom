import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  FileInput,
  Files,
  Inbox,
  LoaderCircle,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SidebarUser } from "./SidebarUser";
import { SubmissionWorkspaceGrid } from "./SubmissionWorkspaceGrid";

type User = { id: string; email: string; name: string };
type EventRecord = {
  id: string;
  organizationName: string;
  name: string;
  status: string;
};
type Submission = {
  id: string;
  formId: string;
  formName: string;
  title: string;
  abstract: string;
  status: string;
  decisionState: string;
  submittedAt: string | null;
  updatedAt: string;
  submitterName: string;
  submitterEmail: string;
  submitterOrganization: string | null;
  reviewCount: number;
  completedReviewCount: number;
  averageScore: number | null;
};
type SubmissionDetail = Submission & {
  answers: Record<string, unknown>;
  createdAt: string;
};
type Field = {
  fieldKey: string;
  label: string;
  fieldType: string;
  section: string;
  position: number;
};
type Person = {
  id: string;
  name: string;
  email: string;
  role: string;
  organization: string | null;
};
type ReviewRound = { id: string; name: string; status: string };
type AiAssessment = {
  id: string;
  roundId: string;
  roundName: string;
  model: string;
  score: number;
  effectiveScore: number;
  reasoning: string;
  strengths: string[];
  risks: string[];
  createdAt: string;
  overriddenScore: number | null;
  overrideReason: string | null;
  overriddenByName: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const result = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "The request could not be completed.",
    );
  return result;
}

export function EventSubmissions({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<EventRecord>();
  const [selected, setSelected] = useState<SubmissionDetail>();
  const [fields, setFields] = useState<Field[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [rounds, setRounds] = useState<ReviewRound[]>([]);
  const [assessments, setAssessments] = useState<AiAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  useEffect(() => {
    Promise.all([
      api<{ event: EventRecord }>(`/api/events/${eventId}`),
      api<{ rounds: ReviewRound[] }>(`/api/reviews/events/${eventId}`),
    ])
      .then(([eventResult, reviewResult]) => {
        setEvent(eventResult.event);
        setRounds(reviewResult.rounds);
      })
      .catch((error: Error) => setFeedback(error.message))
      .finally(() => setLoading(false));
  }, [eventId]);

  async function openSubmission(id: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const [result, aiResult] = await Promise.all([
        api<{
          submission: SubmissionDetail;
          fields: Field[];
          people: Person[];
        }>(`/api/events/${eventId}/submissions/${id}`),
        api<{ assessments: AiAssessment[] }>(
          `/api/reviews/events/${eventId}/submissions/${id}/ai-assessments`,
        ),
      ]);
      setSelected(result.submission);
      setFields(result.fields);
      setPeople(result.people);
      setAssessments(aiResult.assessments);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not open the submission.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeDecision(
    state:
      "none" | "acceptance_staged" | "waitlist_staged" | "rejection_staged",
  ) {
    if (!selected) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await api<{
        submission: { status: string; decisionState: string };
      }>(`/api/events/${eventId}/submissions/${selected.id}/decision`, {
        method: "PATCH",
        body: JSON.stringify({ state }),
      });
      setSelected({
        ...selected,
        status: result.submission.status ?? selected.status,
        decisionState: result.submission.decisionState,
      });
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not stage the decision.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function generateAssessment() {
    if (!selected || !rounds.length) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await api<{ assessment: AiAssessment }>(
        `/api/reviews/events/${eventId}/submissions/${selected.id}/ai-assessments`,
        { method: "POST", body: JSON.stringify({ roundId: rounds[0].id }) },
      );
      setAssessments((current) => [result.assessment, ...current]);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not generate the advisory assessment.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function overrideAssessment(assessment: AiAssessment) {
    if (!selected) return;
    const score = Number(
      window.prompt(
        "Human override score (0–100)",
        String(assessment.effectiveScore),
      ),
    );
    if (!Number.isFinite(score)) return;
    const reason = window.prompt("Why are you overriding this advisory score?");
    if (!reason) return;
    setBusy(true);
    try {
      const result = await api<{
        assessment: { effectiveScore: number; overrideReason: string };
      }>(
        `/api/reviews/events/${eventId}/submissions/${selected.id}/ai-assessments/${assessment.id}/override`,
        { method: "PATCH", body: JSON.stringify({ score, reason }) },
      );
      setAssessments((current) =>
        current.map((item) =>
          item.id === assessment.id
            ? {
                ...item,
                effectiveScore: result.assessment.effectiveScore,
                overriddenScore: result.assessment.effectiveScore,
                overrideReason: result.assessment.overrideReason,
              }
            : item,
        ),
      );
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not override the assessment.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="loading-page" aria-busy="true">
        <LoaderCircle className="spin" /> Loading submissions…
      </main>
    );
  return (
    <div className="event-workspace">
      <aside className="event-sidebar">
        <a className="wordmark" href="/">
          <span aria-hidden="true" className="mark">
            PL
          </span>
          ProgramLoom
        </a>
        <a className="back-link" href="/app">
          <ArrowLeft size={15} /> All events
        </a>
        <div className="event-identity">
          <small>{event?.organizationName}</small>
          <strong>{event?.name}</strong>
          <span>{event?.status}</span>
        </div>
        <nav className="event-nav" aria-label="Event workspace">
          <a href={`/app/events/${eventId}`}>
            <FileInput size={18} /> Call for proposals
          </a>
          <a className="active" href={`/app/events/${eventId}/submissions`}>
            <Inbox size={18} /> Submissions
          </a>
          <a href={`/app/events/${eventId}/reviews`}>
            <CheckCircle2 size={18} /> Reviews
          </a>
          <a href={`/app/events/${eventId}/speakers`}>
            <UsersRound size={18} /> Speakers
          </a>
          <a href={`/app/events/${eventId}/content`}>
            <Files size={18} /> Content
          </a>
          <a href={`/app/events/${eventId}/agenda`}>
            <Clock3 size={18} /> Agenda
          </a>
        </nav>
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="event-main submissions-main">
        <header className="event-heading">
          <div>
            <p className="kicker">Program intake</p>
            <h1>Submissions</h1>
            <p>
              Review the pipeline, open every answer, and prepare decisions
              without losing context.
            </p>
          </div>
        </header>
        {feedback && (
          <div className="form-status form-status-error" role="alert">
            {feedback}
          </div>
        )}
        <SubmissionWorkspaceGrid eventId={eventId} onOpen={openSubmission} />
      </main>
      {selected && (
        <div
          className="detail-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelected(undefined);
          }}
        >
          <aside className="submission-detail" aria-label="Submission details">
            <header>
              <div>
                <small>{selected.formName}</small>
                <h2>{selected.title || "Untitled proposal"}</h2>
              </div>
              <button
                className="plain-icon"
                onClick={() => setSelected(undefined)}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </header>
            <div className="detail-speakers">
              {people.map((person) => (
                <div key={person.id}>
                  <span>{person.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{person.name}</strong>
                    <small>
                      {person.email}
                      {person.organization ? ` · ${person.organization}` : ""}
                    </small>
                  </div>
                </div>
              ))}
            </div>
            <div className="decision-strip">
              <button
                className={
                  selected.decisionState === "acceptance_staged"
                    ? "selected accept"
                    : ""
                }
                onClick={() => changeDecision("acceptance_staged")}
                disabled={busy}
              >
                <ThumbsUp size={16} /> Accept queue
              </button>
              <button
                className={
                  selected.decisionState === "waitlist_staged" ? "selected" : ""
                }
                onClick={() => changeDecision("waitlist_staged")}
                disabled={busy}
              >
                <Clock3 size={16} /> Waitlist
              </button>
              <button
                className={
                  selected.decisionState === "rejection_staged"
                    ? "selected decline"
                    : ""
                }
                onClick={() => changeDecision("rejection_staged")}
                disabled={busy}
              >
                <ThumbsDown size={16} /> Decline queue
              </button>
              <button onClick={() => changeDecision("none")} disabled={busy}>
                Clear
              </button>
            </div>
            <div className="detail-answers">
              {fields.map((field) => (
                <section key={field.fieldKey}>
                  <small>{field.label}</small>
                  <div>
                    {Array.isArray(selected.answers[field.fieldKey])
                      ? (selected.answers[field.fieldKey] as unknown[]).join(
                          ", ",
                        )
                      : typeof selected.answers[field.fieldKey] === "boolean"
                        ? selected.answers[field.fieldKey]
                          ? "Yes"
                          : "No"
                        : String(selected.answers[field.fieldKey] ?? "—")}
                  </div>
                </section>
              ))}
            </div>
            <section className="ai-assessment-section">
              <div className="ai-heading">
                <div>
                  <Bot size={19} />
                  <span>
                    <strong>Advisory AI assessment</strong>
                    <small>
                      Transparent input to human review—not an acceptance
                      decision.
                    </small>
                  </span>
                </div>
                <button
                  className="button button-small"
                  onClick={generateAssessment}
                  disabled={busy || !rounds.length}
                >
                  <Sparkles size={14} /> Assess
                </button>
              </div>
              {assessments.map((assessment) => (
                <article className="ai-assessment" key={assessment.id}>
                  <div>
                    <strong>{assessment.effectiveScore}</strong>
                    <span>/100</span>
                    {assessment.overriddenScore !== null && (
                      <em>Human override</em>
                    )}
                  </div>
                  <section>
                    <small>{assessment.roundName}</small>
                    <p>{assessment.reasoning}</p>
                    {assessment.strengths.length > 0 && (
                      <ul>
                        {assessment.strengths.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {assessment.risks.length > 0 && (
                      <div className="ai-risks">
                        Risks: {assessment.risks.join(" · ")}
                      </div>
                    )}
                    {assessment.overrideReason && (
                      <div className="ai-override-reason">
                        Override rationale: {assessment.overrideReason}
                      </div>
                    )}
                    <button onClick={() => overrideAssessment(assessment)}>
                      Override with human judgment
                    </button>
                  </section>
                </article>
              ))}
              {!assessments.length && (
                <p className="ai-empty">
                  Generate an optional advisory assessment after configuring a
                  review round.
                </p>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
