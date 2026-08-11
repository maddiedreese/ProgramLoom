import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  EyeOff,
  FileInput,
  Files,
  Inbox,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Star,
  UsersRound,
  X,
} from "lucide-react";
import {
  Fragment,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { SidebarUser } from "./SidebarUser";
import { EventLifecycleNav } from "./EventLifecycleNav";
import { EventPageGuide } from "./EventPageGuide";

type User = { id: string; email: string; name: string };
type EventRecord = {
  id: string;
  organizationName: string;
  name: string;
  status: string;
};
type Round = {
  id: string;
  name: string;
  position: number;
  isBlind: boolean;
  opensAt: string | null;
  closesAt: string | null;
  status: string;
  assignmentCount: number;
  completedCount: number;
  reviewerCount: number;
  averageScore: number | null;
};
type ScoreField = {
  id: string;
  roundId: string;
  label: string;
  fieldType: "numeric" | "select" | "text";
  options?: { label: string; value: number }[];
  minValue: number | null;
  maxValue: number | null;
  weight: number;
  required: boolean;
  position: number;
};
type Reviewer = {
  id: string;
  name: string;
  email: string;
  assignmentCount: number;
  completedCount: number;
};
type ReviewerPool = {
  roundId: string;
  reviewerUserId: string;
  capacity: number;
  assignmentCount: number;
  completedCount: number;
};
type ReviewResult = {
  roundId: string;
  submissionId: string;
  title: string;
  aggregateScore: number | null;
  assignmentCount: number;
  completedCount: number;
};
type ReviewDetail = {
  roundId: string;
  submissionId: string;
  assignmentId: string;
  reviewerUserId: string;
  reviewerName: string;
  reviewerEmail: string;
  answers: Record<string, unknown>;
  weightedScore: number | null;
  recommendation: string | null;
  comment: string | null;
  submittedAt: string | null;
};
type Submission = {
  id: string;
  title: string;
  submitterName: string;
  status: string;
};
type Assignment = {
  id: string;
  submissionId: string;
  title: string;
  abstract: string;
  roundId: string;
  roundName: string;
  isBlind: boolean;
  closesAt: string | null;
  roundStatus: string;
  completedAt: string | null;
  weightedScore: number | null;
  recommendation: string | null;
};
type AssignmentDetail = Assignment & {
  answers: Record<string, unknown>;
  reviewAnswers: Record<string, unknown>;
  recommendation: string | null;
  comment: string | null;
  reviewSubmittedAt: string | null;
};
type FormField = { fieldKey: string; label: string; section: string };
type Person = {
  name: string;
  email: string;
  role: string;
  organization: string | null;
};

function reviewRoundDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "No date";
}

function localDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
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

function EventChrome({
  event,
  user,
  eventId,
  role,
  children,
  active,
}: {
  event?: EventRecord;
  user: User;
  eventId: string;
  role?: string;
  children: React.ReactNode;
  active: "reviews";
}) {
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
        <EventLifecycleNav eventId={eventId} active={active} role={role} />
        <SidebarUser user={user} />
      </aside>
      {children}
    </div>
  );
}

export function EventReviews({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<EventRecord>();
  const [role, setRole] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  useEffect(() => {
    api<{ event: EventRecord; role: string }>(`/api/events/${eventId}`)
      .then((result) => {
        setEvent(result.event);
        setRole(result.role);
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [eventId]);
  if (loading)
    return (
      <main className="loading-page" aria-busy="true">
        <LoaderCircle className="spin" /> Loading reviews…
      </main>
    );
  return (
    <EventChrome
      event={event}
      user={user}
      eventId={eventId}
      role={role}
      active="reviews"
    >
      <main id="main-content" className="event-main reviews-main">
        {feedback && (
          <div className={`form-status form-status-${feedback.kind}`}>
            {feedback.message}
          </div>
        )}
        {role === "reviewer" ? (
          <ReviewerQueue eventId={eventId} />
        ) : (
          <OrganizerReviews eventId={eventId} />
        )}
      </main>
    </EventChrome>
  );
}

function OrganizerReviews({ eventId }: { eventId: string }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [scorecards, setScorecards] = useState<ScoreField[]>([]);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviewerPools, setReviewerPools] = useState<ReviewerPool[]>([]);
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [reviewDetails, setReviewDetails] = useState<ReviewDetail[]>([]);
  const [expandedResult, setExpandedResult] = useState<string>();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string>();
  const [lastAssignedRoundId, setLastAssignedRoundId] = useState<string>();
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [resultSort, setResultSort] = useState<"desc" | "asc">("desc");
  const [aiAssessment, setAiAssessment] = useState<{
    id: string;
    submissionId: string;
    score: number;
    effectiveScore: number;
    reasoning: string;
    overrideReason: string | null;
  }>();
  const selected = rounds.find((round) => round.id === selectedRoundId);
  const reviewerCapacity = useMemo(
    () =>
      new Map(
        reviewerPools
          .filter((entry) => entry.roundId === selectedRoundId)
          .map((entry) => [entry.reviewerUserId, entry.capacity]),
      ),
    [reviewerPools, selectedRoundId],
  );
  useEffect(() => {
    if (!feedback) return;
    window.requestAnimationFrame(() => {
      feedbackRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
      feedbackRef.current?.focus({ preventScroll: true });
    });
  }, [feedback]);
  async function load(preferred?: string) {
    const [config, intake] = await Promise.all([
      api<{
        rounds: Round[];
        scorecards: ScoreField[];
        reviewers: Reviewer[];
        reviewerPools: ReviewerPool[];
        results: ReviewResult[];
        reviewDetails: ReviewDetail[];
      }>(`/api/reviews/events/${eventId}`),
      api<{ submissions: Submission[] }>(`/api/events/${eventId}/submissions`),
    ]);
    setRounds(config.rounds);
    setScorecards(config.scorecards);
    setReviewers(config.reviewers);
    setReviewerPools(config.reviewerPools ?? []);
    setResults(config.results ?? []);
    setReviewDetails(config.reviewDetails ?? []);
    setSubmissions(intake.submissions);
    setSelectedRoundId(preferred ?? selectedRoundId ?? config.rounds[0]?.id);
  }
  useEffect(() => {
    load().catch((error: Error) =>
      setFeedback({ kind: "error", message: error.message }),
    );
  }, [eventId]);
  async function createRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    const data = new FormData(formElement);
    try {
      const result = await api<{ round: Round }>(
        `/api/reviews/events/${eventId}/rounds`,
        {
          method: "POST",
          body: JSON.stringify({
            name: data.get("name"),
            isBlind: data.get("isBlind") === "on",
            opensAt: data.get("opensAt")
              ? new Date(String(data.get("opensAt"))).toISOString()
              : null,
            closesAt: data.get("closesAt")
              ? new Date(String(data.get("closesAt"))).toISOString()
              : null,
          }),
        },
      );
      formElement.reset();
      await load(result.round.id);
      setFeedback({
        kind: "success",
        message: "Review round created. Add its scorecard next.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not create the round.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function addField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    setBusy(true);
    const data = new FormData(formElement);
    const type = String(data.get("fieldType"));
    const options = String(data.get("options") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, rawScore] = line.split("|");
        return { label: label.trim(), value: Number(rawScore) };
      });
    try {
      await api(`/api/reviews/events/${eventId}/rounds/${selected.id}/fields`, {
        method: "POST",
        body: JSON.stringify({
          label: data.get("label"),
          fieldType: type,
          minValue:
            type === "numeric" ? Number(data.get("minValue")) : undefined,
          maxValue:
            type === "numeric" ? Number(data.get("maxValue")) : undefined,
          options: type === "select" ? options : undefined,
          weight: Number(data.get("weight") || 1),
          required: data.get("required") === "on",
        }),
      });
      formElement.reset();
      await load(selected.id);
      setFeedback({ kind: "success", message: "Scorecard field added." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not add the score field.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function runAiAssessment(submissionId: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await api<{ assessment: typeof aiAssessment }>(
        `/api/reviews/events/${eventId}/submissions/${submissionId}/ai-assessments`,
        {
          method: "POST",
          body: JSON.stringify({ roundId: selected.id }),
        },
      );
      setAiAssessment({ ...result.assessment!, submissionId });
      setFeedback({
        kind: "success",
        message:
          "Advisory assessment generated. Review the reasoning or record a human override.",
      });
      window.requestAnimationFrame(() => {
        const target = document.getElementById("advisory-ai-assessment");
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
    } catch (error) {
      try {
        const existing = await api<{
          assessments: Array<{
            id: string;
            submissionId?: string;
            score: number;
            effectiveScore: number;
            reasoning: string;
            overrideReason: string | null;
          }>;
        }>(
          `/api/reviews/events/${eventId}/submissions/${submissionId}/ai-assessments`,
        );
        const latest = existing.assessments[0];
        if (!latest) throw error;
        setAiAssessment({ ...latest, submissionId });
        setFeedback({
          kind: "success",
          message:
            "The latest advisory assessment is shown below. Generate again after the one-minute duplicate-protection window if a fresh run is needed.",
        });
        window.requestAnimationFrame(() => {
          const target = document.getElementById("advisory-ai-assessment");
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          target?.focus({ preventScroll: true });
        });
      } catch {
        setFeedback({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Assessment failed.",
        });
      }
    } finally {
      setBusy(false);
    }
  }
  async function overrideAiAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!aiAssessment) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await api<{
        assessment: { effectiveScore: number; overrideReason: string };
      }>(
        `/api/reviews/events/${eventId}/submissions/${aiAssessment.submissionId}/ai-assessments/${aiAssessment.id}/override`,
        {
          method: "PATCH",
          body: JSON.stringify({
            score: Number(data.get("score")),
            reason: data.get("reason"),
          }),
        },
      );
      setAiAssessment({ ...aiAssessment, ...result.assessment });
      setFeedback({
        kind: "success",
        message: "Human override saved with its reason and audit history.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Override failed.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function setRoundStatus(status: string) {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/reviews/events/${eventId}/rounds/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load(selected.id);
      setFeedback({
        kind: "success",
        message:
          status === "open"
            ? "Round opened. Assigned reviewers can now score."
            : `Round ${status}.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not update the round.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function updateRoundWindow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`/api/reviews/events/${eventId}/rounds/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          opensAt: data.get("opensAt")
            ? new Date(String(data.get("opensAt"))).toISOString()
            : null,
          closesAt: data.get("closesAt")
            ? new Date(String(data.get("closesAt"))).toISOString()
            : null,
          isBlind: data.get("isBlind") === "on",
        }),
      });
      await load(selected.id);
      setFeedback({
        kind: "success",
        message:
          "Review window saved. Next, assign reviewers and open the round when scoring should begin.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save the review window.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const selectedSubmissions = data.getAll("submissionId").map(String);
    const selectedReviewers = data.getAll("reviewerUserId").map(String);
    if (!selectedSubmissions.length || !selectedReviewers.length) {
      setFeedback({
        kind: "error",
        message:
          "Select at least one proposal and one reviewer before creating assignments.",
      });
      return;
    }
    setBusy(true);
    try {
      const result = await api<{
        created: number;
        alreadyAssigned: number;
        capacitySkipped: number;
        conflicts: { reason: string }[];
        roundOpened: boolean;
      }>(`/api/reviews/events/${eventId}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          roundId: selected.id,
          submissionIds: selectedSubmissions,
          reviewerUserIds: selectedReviewers,
        }),
      });
      await load(selected.id);
      formElement.reset();
      if ((result.created || result.alreadyAssigned) && !result.roundOpened)
        setLastAssignedRoundId(selected.id);
      setFeedback({
        kind: result.conflicts.length ? "error" : "success",
        message: `${result.created} reviewer ${result.created === 1 ? "assignment" : "assignments"} created.${result.alreadyAssigned ? ` ${result.alreadyAssigned} already existed and were left unchanged.` : ""}${result.capacitySkipped ? ` ${result.capacitySkipped} exceeded configured reviewer capacity and were skipped.` : ""}${result.conflicts.length ? ` ${result.conflicts.length} speaker/reviewer conflicts were safely skipped.` : result.roundOpened ? ` ${selected.name} is now open because its configured opening time has arrived; reviewers can begin scoring.` : " Open the round when reviewers should begin scoring."}`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not create assignments.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveReviewerPool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const reviewerIds = data.getAll("reviewerUserId").map(String);
    setBusy(true);
    try {
      await api(
        `/api/reviews/events/${eventId}/rounds/${selected.id}/reviewer-pool`,
        {
          method: "PUT",
          body: JSON.stringify({
            reviewers: reviewerIds.map((reviewerUserId) => ({
              reviewerUserId,
              capacity: Number(data.get(`capacity-${reviewerUserId}`) || 20),
            })),
          }),
        },
      );
      await load(selected.id);
      setFeedback({
        kind: "success",
        message:
          "Reviewer pool saved for this round. Assignments now respect its membership and capacity limits.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not save the pool.",
      });
    } finally {
      setBusy(false);
    }
  }
  const activePool = reviewerPools.filter(
    (entry) => entry.roundId === selected?.id,
  );
  const assignableReviewers = activePool.length
    ? reviewers.filter((reviewer) =>
        activePool.some((entry) => entry.reviewerUserId === reviewer.id),
      )
    : reviewers;
  return (
    <>
      <header className="event-heading">
        <div>
          <p className="kicker">Proposal evaluation</p>
          <h1>Assign reviewers and complete evaluations.</h1>
          <p>
            Set the questions reviewers answer, assign proposals, and see which
            evaluations are ready for an organizer decision.
          </p>
        </div>
        {selected && (
          <div className="round-actions">
            <button
              className="button button-small"
              type="button"
              onClick={() =>
                document
                  .getElementById("assign-reviewers")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <UsersRound size={15} /> Go to reviewer assignment
            </button>
            <button
              className="button button-ghost button-small"
              onClick={() =>
                setRoundStatus(selected.status === "open" ? "closed" : "open")
              }
              disabled={busy}
            >
              {selected.status === "open"
                ? `Close ${selected.name}`
                : `Open ${selected.name}`}
            </button>
          </div>
        )}
      </header>
      <EventPageGuide eventId={eventId} surface="reviews" />
      {feedback && (
        <div
          ref={feedbackRef}
          className={`form-status form-status-${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
          tabIndex={-1}
        >
          {feedback.message}
        </div>
      )}
      <div className="review-admin-layout">
        <aside className="round-list">
          <div className="panel-title">
            <div>
              <h2>Rounds</h2>
              <span>{rounds.length}</span>
            </div>
          </div>
          {rounds.map((round) => (
            <button
              className={round.id === selectedRoundId ? "selected" : ""}
              onClick={() => setSelectedRoundId(round.id)}
              key={round.id}
            >
              <span>
                <strong>{round.name}</strong>
                <small>
                  {round.status} · {round.completedCount}/
                  {round.assignmentCount} complete
                </small>
                <small>
                  {reviewRoundDate(round.opensAt)}–
                  {reviewRoundDate(round.closesAt)} ·{" "}
                  {
                    scorecards.filter((field) => field.roundId === round.id)
                      .length
                  }{" "}
                  criteria
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
          <form onSubmit={createRound}>
            <label>
              New round
              <input name="name" placeholder="Round 1: Program fit" required />
            </label>
            <label className="check-row">
              <input name="isBlind" type="checkbox" />
              <span>
                <strong>Blind review</strong>
                <small>
                  Hide speaker identity and speaker-section answers.
                </small>
              </span>
            </label>
            <label>
              Opens
              <input name="opensAt" type="datetime-local" />
            </label>
            <label>
              Closes
              <input name="closesAt" type="datetime-local" />
            </label>
            <button
              className="button button-small"
              disabled={busy}
              aria-label="Create round"
            >
              <Plus size={15} /> Create round
            </button>
          </form>
        </aside>
        <section className="review-config">
          {!selected ? (
            <div className="builder-empty">
              <Star size={34} />
              <h2>Create a review round</h2>
              <p>
                A round is one evaluation phase with its own questions,
                reviewers, and deadline—for example, initial screening or final
                selection.
              </p>
            </div>
          ) : (
            <>
              <div className="review-round-heading">
                <div>
                  <span
                    className={`status-dot ${selected.status === "open" ? "live" : ""}`}
                  />
                  {selected.status}
                  <h2>{selected.name}</h2>
                  {selected.isBlind && (
                    <em>
                      <EyeOff size={13} /> Blind
                    </em>
                  )}
                </div>
                <div>
                  <strong>{selected.averageScore ?? "—"}</strong>
                  <small>Average score</small>
                </div>
              </div>
              <div className="review-stats">
                <div>
                  <strong>{selected.assignmentCount}</strong>
                  <span>Assignments</span>
                </div>
                <div>
                  <strong>{selected.completedCount}</strong>
                  <span>Completed</span>
                </div>
                <div>
                  <strong>{selected.reviewerCount}</strong>
                  <span>Reviewers</span>
                </div>
              </div>
              <form
                className="review-window-form"
                key={selected.id}
                onSubmit={updateRoundWindow}
              >
                <div>
                  <strong>Review window</strong>
                  <small>
                    Deadlines are stored durably for this round and shown to
                    assigned reviewers.
                  </small>
                </div>
                <label>
                  Opens
                  <input
                    name="opensAt"
                    type="datetime-local"
                    defaultValue={localDateTimeValue(selected.opensAt)}
                  />
                </label>
                <label>
                  Closes
                  <input
                    name="closesAt"
                    type="datetime-local"
                    defaultValue={localDateTimeValue(selected.closesAt)}
                  />
                </label>
                <label className="check-row">
                  <input
                    name="isBlind"
                    type="checkbox"
                    defaultChecked={selected.isBlind}
                  />
                  <span>
                    <strong>Blind review</strong>
                    <small>Hide speaker identity from reviewers.</small>
                  </span>
                </label>
                <button className="button button-small" disabled={busy}>
                  Save review round settings
                </button>
              </form>
              <form
                className="reviewer-pool-form"
                key={`pool-${selected.id}`}
                onSubmit={saveReviewerPool}
              >
                <div>
                  <h3>Reviewer pool and capacity</h3>
                  <p>
                    Choose who may review this round and cap each reviewer’s
                    workload. Leave every reviewer unchecked to use the full
                    event reviewer roster without caps.
                  </p>
                </div>
                <div className="reviewer-pool-grid">
                  {reviewers.map((reviewer) => {
                    const membership = activePool.find(
                      (entry) => entry.reviewerUserId === reviewer.id,
                    );
                    return (
                      <div className="reviewer-pool-row" key={reviewer.id}>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            name="reviewerUserId"
                            value={reviewer.id}
                            defaultChecked={Boolean(membership)}
                          />
                          <span>
                            <strong>{reviewer.name}</strong>
                            <small>{reviewer.email}</small>
                          </span>
                        </label>
                        <label>
                          Capacity
                          <input
                            name={`capacity-${reviewer.id}`}
                            type="number"
                            min="1"
                            max="500"
                            defaultValue={membership?.capacity ?? 20}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
                <p className="inline-empty" role="status">
                  {activePool.length
                    ? `${selected.name} pool: ${activePool
                        .map((membership) => {
                          const reviewer = reviewers.find(
                            (item) => item.id === membership.reviewerUserId,
                          );
                          return `${reviewer?.name ?? "Reviewer"} (capacity ${membership.capacity})`;
                        })
                        .join(", ")}. Other rounds keep separate pools.`
                    : `${selected.name} has no dedicated pool. The full event reviewer roster is available only for this round until a pool is saved.`}
                </p>
                {!reviewers.length && (
                  <p className="inline-empty">
                    Invite a reviewer before configuring this round’s pool.
                  </p>
                )}
                <button
                  className="button button-small"
                  disabled={busy || !reviewers.length}
                >
                  Save {selected.name} reviewer pool
                </button>
              </form>
              <section className="scorecard-section">
                <div>
                  <h3>Scorecard</h3>
                  <p>
                    Weights combine numeric and scored-select answers into one
                    aggregate.
                  </p>
                </div>
                <div className="scorecard-list">
                  {scorecards
                    .filter((field) => field.roundId === selected.id)
                    .map((field) => (
                      <div key={field.id}>
                        <Star size={15} />
                        <span>
                          <strong>{field.label}</strong>
                          <small>
                            {field.fieldType} · weight {field.weight}
                            {field.required ? " · required" : ""}
                          </small>
                        </span>
                      </div>
                    ))}
                </div>
                <form className="score-field-form" onSubmit={addField}>
                  <label>
                    Criterion
                    <input name="label" placeholder="Audience value" required />
                  </label>
                  <label>
                    Type
                    <select name="fieldType" defaultValue="numeric">
                      <option value="numeric">Numeric</option>
                      <option value="select">Scored select</option>
                      <option value="text">Reviewer note</option>
                    </select>
                  </label>
                  <label>
                    Minimum
                    <input name="minValue" type="number" defaultValue="1" />
                  </label>
                  <label>
                    Maximum
                    <input name="maxValue" type="number" defaultValue="5" />
                  </label>
                  <label>
                    Weight
                    <input
                      name="weight"
                      type="number"
                      min="0.1"
                      step="0.1"
                      defaultValue="1"
                    />
                  </label>
                  <label className="wide">
                    Select options <small>One per line as Label|Score</small>
                    <textarea
                      name="options"
                      rows={3}
                      placeholder={"Strong yes|5\nMaybe|3\nNo|1"}
                    />
                  </label>
                  <label className="check-row wide">
                    <input name="required" type="checkbox" defaultChecked />
                    <span>
                      <strong>Required</strong>
                      <small>
                        Final review cannot submit without this answer.
                      </small>
                    </span>
                  </label>
                  <button className="button wide" disabled={busy}>
                    <Plus size={15} /> Add criterion
                  </button>
                </form>
              </section>
              <form
                className="assignment-section"
                id="assign-reviewers"
                onSubmit={assign}
              >
                <div>
                  <h3>Assign reviewers</h3>
                  <p>
                    Choose submissions and invited reviewers. Speaker/self
                    conflicts are skipped automatically.
                  </p>
                </div>
                <p id="assignment-selection-status">
                  Select each proposal and reviewer exactly once, then choose
                  Assign reviewers. Selections remain stable while you work
                  through the list. If this draft round's configured opening
                  time has arrived, assigning reviewers opens it so their work
                  is immediately visible.
                </p>
                {reviewers.length ? (
                  <div className="assignment-columns">
                    <div>
                      <h4>Submissions</h4>
                      {submissions.map((submission) => (
                        <label
                          className="assignment-choice"
                          key={submission.id}
                        >
                          <input
                            type="checkbox"
                            name="submissionId"
                            value={submission.id}
                            aria-label={`Select proposal for assignment: ${submission.title}`}
                          />
                          <span>
                            <strong>{submission.title}</strong>
                            <small>
                              {submission.submitterName} · {submission.status}
                            </small>
                            {results.find(
                              (result) =>
                                result.roundId === selected.id &&
                                result.submissionId === submission.id,
                            ) && (
                              <small>
                                Assigned in {selected.name}:{" "}
                                {reviewDetails
                                  .filter(
                                    (detail) =>
                                      detail.roundId === selected.id &&
                                      detail.submissionId === submission.id,
                                  )
                                  .map((detail) => detail.reviewerName)
                                  .join(", ") || "reviewer assigned"}
                              </small>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div>
                      <h4>Reviewers</h4>
                      {assignableReviewers.map((reviewer) => {
                        const progress = activePool.find(
                          (entry) => entry.reviewerUserId === reviewer.id,
                        );
                        const roundAssignments = reviewDetails.filter(
                          (detail) =>
                            detail.roundId === selected.id &&
                            detail.reviewerUserId === reviewer.id,
                        );
                        const assignmentCount =
                          progress?.assignmentCount ?? roundAssignments.length;
                        const completedCount =
                          progress?.completedCount ??
                          roundAssignments.filter(
                            (detail) => detail.submittedAt,
                          ).length;
                        return (
                          <label
                            className="assignment-choice"
                            key={reviewer.id}
                          >
                            <input
                              type="checkbox"
                              name="reviewerUserId"
                              value={reviewer.id}
                              aria-label={`Select reviewer for assignment: ${reviewer.name}`}
                            />
                            <span>
                              <strong>{reviewer.name}</strong>
                              <small>
                                {reviewerCapacity.has(reviewer.id)
                                  ? `Capacity ${reviewerCapacity.get(reviewer.id)} · `
                                  : ""}
                                {completedCount}/{assignmentCount} complete in{" "}
                                {selected.name}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="inline-empty">
                    <UsersRound size={24} />
                    <span>
                      No invited reviewers yet. Invite one, then return here to
                      assign proposals.
                      <a className="text-link" href="/app/team">
                        Invite reviewers
                      </a>
                    </span>
                  </div>
                )}
                <button
                  className="button"
                  aria-describedby="assignment-selection-status"
                  disabled={busy}
                >
                  Assign reviewers
                </button>
                {lastAssignedRoundId === selected.id &&
                  selected.status === "draft" && (
                    <div className="form-status form-status-success">
                      <strong>
                        Assignments are saved. Reviewers cannot see this draft
                        round yet.
                      </strong>{" "}
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() => setRoundStatus("open")}
                        disabled={busy}
                      >
                        Open {selected.name} for reviewer scoring
                      </button>
                    </div>
                  )}
              </form>
              <section className="review-results-section">
                <div>
                  <h3>Review progress and aggregate results</h3>
                  <p>
                    Completion and weighted scores come from submitted reviews
                    in this round. Sort or export the complete live result set.
                  </p>
                </div>
                <div className="inline-actions">
                  <label>
                    Sort weighted aggregate score
                    <select
                      value={resultSort}
                      onChange={(event) =>
                        setResultSort(event.target.value as "desc" | "asc")
                      }
                    >
                      <option value="desc">Highest first</option>
                      <option value="asc">Lowest first</option>
                    </select>
                  </label>
                  <a
                    className="button button-ghost button-small"
                    href={`/api/reviews/events/${eventId}/export?roundId=${selected.id}`}
                  >
                    <Download size={14} /> Export review results CSV
                  </a>
                </div>
                <div className="review-progress-grid">
                  {assignableReviewers.map((reviewer) => {
                    const progress = activePool.find(
                      (entry) => entry.reviewerUserId === reviewer.id,
                    );
                    const roundAssignments = reviewDetails.filter(
                      (detail) =>
                        detail.roundId === selected.id &&
                        detail.reviewerUserId === reviewer.id,
                    );
                    const assignmentCount =
                      progress?.assignmentCount ?? roundAssignments.length;
                    const completedCount =
                      progress?.completedCount ??
                      roundAssignments.filter((detail) => detail.submittedAt)
                        .length;
                    return (
                      <article key={reviewer.id}>
                        <strong>{reviewer.name}</strong>
                        <span>
                          {completedCount}/{assignmentCount} complete in{" "}
                          {selected.name}
                        </span>
                        {progress && (
                          <small>Capacity {progress.capacity}</small>
                        )}
                        <a
                          className="text-link"
                          href={`/app/events/${eventId}/communications?compose=1&category=reviewer_reminder&entity=${reviewer.id}`}
                        >
                          Send reviewer reminder
                        </a>
                      </article>
                    );
                  })}
                </div>
                {results.some((result) => result.roundId === selected.id) ? (
                  <div className="table-scroll" tabIndex={0}>
                    <table>
                      <thead>
                        <tr>
                          <th>Submission</th>
                          <th>Progress</th>
                          <th>Weighted aggregate score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results
                          .filter((result) => result.roundId === selected.id)
                          .sort((left, right) => {
                            const leftScore = left.aggregateScore ?? -Infinity;
                            const rightScore =
                              right.aggregateScore ?? -Infinity;
                            return resultSort === "desc"
                              ? rightScore - leftScore
                              : leftScore - rightScore;
                          })
                          .map((result) => (
                            <Fragment key={result.submissionId}>
                              <tr>
                                <td>{result.title}</td>
                                <td>
                                  {result.completedCount}/
                                  {result.assignmentCount}
                                </td>
                                <td>
                                  {result.aggregateScore ?? "Pending"}
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      setExpandedResult((current) =>
                                        current === result.submissionId
                                          ? undefined
                                          : result.submissionId,
                                      )
                                    }
                                    aria-expanded={
                                      expandedResult === result.submissionId
                                    }
                                  >
                                    {expandedResult === result.submissionId
                                      ? "Close review details"
                                      : "View review details"}
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      runAiAssessment(result.submissionId)
                                    }
                                    disabled={busy}
                                  >
                                    Generate AI assessment
                                  </button>
                                </td>
                              </tr>
                              {expandedResult === result.submissionId && (
                                <tr
                                  className="review-detail-row"
                                  key={`${result.submissionId}:details`}
                                >
                                  <td colSpan={3}>
                                    <h4>Individual review details</h4>
                                    {reviewDetails
                                      .filter(
                                        (detail) =>
                                          detail.roundId === selected.id &&
                                          detail.submissionId ===
                                            result.submissionId,
                                      )
                                      .map((detail) => (
                                        <article key={detail.assignmentId}>
                                          <strong>{detail.reviewerName}</strong>
                                          <span>
                                            {detail.submittedAt
                                              ? `Completed · score ${detail.weightedScore ?? "not scored"}`
                                              : "Awaiting review"}
                                          </span>
                                          {detail.recommendation && (
                                            <p>
                                              Recommendation:{" "}
                                              {detail.recommendation}
                                            </p>
                                          )}
                                          {detail.comment && (
                                            <p>Comment: {detail.comment}</p>
                                          )}
                                          {Object.keys(detail.answers).length >
                                            0 && (
                                            <dl>
                                              {Object.entries(
                                                detail.answers,
                                              ).map(([fieldId, value]) => (
                                                <div key={fieldId}>
                                                  <dt>
                                                    {scorecards.find(
                                                      (field) =>
                                                        field.id === fieldId,
                                                    )?.label ?? "Criterion"}
                                                  </dt>
                                                  <dd>{String(value)}</dd>
                                                </div>
                                              ))}
                                            </dl>
                                          )}
                                        </article>
                                      ))}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="inline-empty">
                    Assign reviewers to populate aggregate results.
                  </div>
                )}
                {aiAssessment && (
                  <section
                    className="ai-assessment-card"
                    id="advisory-ai-assessment"
                    tabIndex={-1}
                    aria-live="polite"
                  >
                    <div>
                      <h4>Advisory AI assessment</h4>
                      <strong>{aiAssessment.effectiveScore}/100</strong>
                      <p>{aiAssessment.reasoning}</p>
                      {aiAssessment.overrideReason && (
                        <small>
                          Human override: {aiAssessment.overrideReason}
                        </small>
                      )}
                    </div>
                    <form onSubmit={overrideAiAssessment}>
                      <label>
                        Human score
                        <input
                          name="score"
                          type="number"
                          min="0"
                          max="100"
                          defaultValue={aiAssessment.effectiveScore}
                          required
                        />
                      </label>
                      <label>
                        Override reason
                        <input name="reason" minLength={3} required />
                      </label>
                      <button className="button button-small" disabled={busy}>
                        Override assessment
                      </button>
                    </form>
                  </section>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function ReviewerQueue({ eventId }: { eventId: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selected, setSelected] = useState<AssignmentDetail>();
  const [fields, setFields] = useState<FormField[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [scorecard, setScorecard] = useState<ScoreField[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  async function load() {
    const result = await api<{ assignments: Assignment[] }>(
      `/api/reviews/me/assignments?eventId=${eventId}`,
    );
    setAssignments(result.assignments);
  }
  useEffect(() => {
    load().catch((error: Error) =>
      setFeedback({ kind: "error", message: error.message }),
    );
  }, [eventId]);
  async function open(id: string) {
    setBusy(true);
    try {
      const result = await api<{
        assignment: AssignmentDetail;
        fields: FormField[];
        people: Person[];
        scorecard: ScoreField[];
      }>(`/api/reviews/me/assignments/${id}`);
      setSelected(result.assignment);
      setFields(result.fields);
      setPeople(result.people);
      setScorecard(result.scorecard);
      setAnswers(result.assignment.reviewAnswers);
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not open the assignment.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function saveReview(
    event: FormEvent<HTMLFormElement>,
    submit: boolean,
  ) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setFieldErrors({});
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ review: { weightedScore: number | null } }>(
        `/api/reviews/me/assignments/${selected.id}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            answers,
            recommendation: data.get("recommendation"),
            comment: data.get("comment"),
            submit,
          }),
        },
      );
      setSelected({
        ...selected,
        weightedScore: result.review.weightedScore,
        reviewSubmittedAt: submit ? new Date().toISOString() : null,
      });
      await load();
      if (submit) setSelected(undefined);
      setFeedback({
        kind: "success",
        message: submit
          ? "Review completed. The organizer can now inspect the score and stage a decision."
          : "Review draft saved. Complete review when every required answer is ready.",
      });
    } catch (error) {
      const typed = error as Error & { fields?: Record<string, string> };
      setFieldErrors(typed.fields ?? {});
      setFeedback({ kind: "error", message: typed.message });
    } finally {
      setBusy(false);
    }
  }
  async function recuse() {
    if (!selected) return;
    const reason = window.prompt("Why are you unable to review this proposal?");
    if (!reason) return;
    try {
      await api(`/api/reviews/me/assignments/${selected.id}/recuse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setSelected(undefined);
      await load();
      setFeedback({
        kind: "success",
        message: "You were recused. The organizer can reassign the proposal.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not recuse.",
      });
    }
  }
  function scoreInput(field: ScoreField) {
    const value = answers[field.id];
    if (field.fieldType === "text")
      return (
        <textarea
          rows={4}
          value={String(value ?? "")}
          onChange={(event) =>
            setAnswers((current) => ({
              ...current,
              [field.id]: event.target.value,
            }))
          }
        />
      );
    if (field.fieldType === "select")
      return (
        <select
          value={String(value ?? "")}
          onChange={(event) =>
            setAnswers((current) => ({
              ...current,
              [field.id]: event.target.value,
            }))
          }
        >
          <option value="">Choose…</option>
          {field.options?.map((option) => (
            <option key={option.label}>{option.label}</option>
          ))}
        </select>
      );
    return (
      <input
        type="number"
        min={field.minValue ?? undefined}
        max={field.maxValue ?? undefined}
        step="0.1"
        value={String(value ?? "")}
        onChange={(event) =>
          setAnswers((current) => ({
            ...current,
            [field.id]:
              event.target.value === "" ? "" : Number(event.target.value),
          }))
        }
      />
    );
  }
  return (
    <>
      <header className="event-heading">
        <div>
          <p className="kicker">Reviewer workspace</p>
          <h1>Your review queue</h1>
          <p>Only proposals explicitly assigned to you appear here.</p>
        </div>
        <div className="submission-total">
          <strong>
            {assignments.filter((item) => item.completedAt).length}/
            {assignments.length}
          </strong>
          <span>Complete</span>
        </div>
      </header>
      {feedback && (
        <div className={`form-status form-status-${feedback.kind}`}>
          {feedback.message}
        </div>
      )}
      <section className="reviewer-list">
        {assignments.length ? (
          assignments.map((assignment) => (
            <button onClick={() => open(assignment.id)} key={assignment.id}>
              <span
                className={
                  assignment.completedAt ? "review-complete" : "review-pending"
                }
              >
                {assignment.completedAt ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <Star size={16} />
                )}
              </span>
              <span>
                <small>
                  {assignment.roundName}
                  {assignment.isBlind ? " · Blind" : ""}
                </small>
                <strong>{assignment.title}</strong>
                <p>{assignment.abstract}</p>
              </span>
              <span>
                <strong>{assignment.weightedScore ?? "—"}</strong>
                <small>Score</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))
        ) : (
          <div className="submission-empty">
            <ShieldCheck size={32} />
            <h2>Your queue is clear</h2>
            <p>
              Assigned proposals will appear here when a review round opens.
            </p>
          </div>
        )}
      </section>
      {selected && (
        <div className="detail-backdrop">
          <aside
            className="review-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Review details"
          >
            <header>
              <div>
                <small>
                  {selected.roundName}
                  {selected.isBlind ? " · Blind review" : ""}
                </small>
                <h2>{selected.title}</h2>
              </div>
              <button
                className="button button-small button-ghost"
                data-dismiss
                onClick={() => setSelected(undefined)}
              >
                <X size={16} /> Close review details
              </button>
            </header>
            <div className="review-proposal">
              {!selected.isBlind &&
                people.map((person) => (
                  <div className="review-person" key={person.email}>
                    <strong>{person.name}</strong>
                    <span>{person.organization || person.email}</span>
                  </div>
                ))}
              {fields.map((field) => (
                <section key={field.fieldKey}>
                  <small>{field.label}</small>
                  <div>{String(selected.answers[field.fieldKey] ?? "—")}</div>
                </section>
              ))}
            </div>
            <form
              className="review-scorecard"
              onSubmit={(event) =>
                saveReview(
                  event,
                  (
                    (event.nativeEvent as SubmitEvent)
                      .submitter as HTMLButtonElement | null
                  )?.value !== "draft",
                )
              }
            >
              <h3>Scorecard</h3>
              {scorecard.map((field) => (
                <label key={field.id}>
                  {field.label}
                  {field.required && <em>Required</em>}
                  <small>Weight {field.weight}</small>
                  {scoreInput(field)}
                  {fieldErrors[field.id] && (
                    <span className="field-error">{fieldErrors[field.id]}</span>
                  )}
                </label>
              ))}
              <label>
                Recommendation
                <select
                  name="recommendation"
                  defaultValue={selected.recommendation ?? "maybe"}
                >
                  <option value="approve">Approve</option>
                  <option value="maybe">Maybe</option>
                  <option value="deny">Deny</option>
                </select>
              </label>
              <label>
                Reviewer comment
                <textarea
                  name="comment"
                  rows={5}
                  defaultValue={selected.comment ?? ""}
                />
                <small>
                  No character limit. The complete comment is saved.
                </small>
              </label>
              <div className="review-actions">
                <button
                  className="button button-ghost"
                  value="draft"
                  disabled={busy}
                >
                  <Save size={15} /> Save draft
                </button>
                <button className="button" value="submit" disabled={busy}>
                  <CheckCircle2 size={15} />
                  {busy ? "Completing review…" : "Complete review"}
                </button>
              </div>
              <button type="button" className="recuse-link" onClick={recuse}>
                Declare a conflict or recuse myself
              </button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
