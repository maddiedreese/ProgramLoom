export type LifecycleState =
  "Not started" | "In progress" | "Blocked" | "Complete";

export type LifecycleSnapshot = {
  publishedForms: number;
  proposals: number;
  reviewAssignments: number;
  completedReviews: number;
  unassignedPending: number;
  reviewConflicts: number;
  reviewedProposals: number;
  finalDecisions: number;
  stagedDecisions: number;
  acceptedSpeakers: number;
  readySpeakers: number;
  acceptedSessions: number;
  approvedSessions: number;
  needsChangesContent: number;
  placedSessions: number;
  openScheduleConflicts: number;
  publishedSessions: number;
};

export type LifecycleStage = {
  number: number;
  label: string;
  state: LifecycleState;
  count: number;
  total: number;
  countLabel: string;
  blockerCount: number;
  primaryAction: string;
  actionUrl: string;
};

export function deriveLifecycleState(input: {
  started: boolean;
  current: number;
  total: number;
  blockers: number;
}): LifecycleState {
  if (!input.started && input.current === 0) return "Not started";
  if (input.blockers > 0) return "Blocked";
  if (input.total > 0 && input.current >= input.total) return "Complete";
  return "In progress";
}

export function buildLifecycleStages(
  snapshot: LifecycleSnapshot,
  eventId: string,
): LifecycleStage[] {
  const stage = (
    number: number,
    label: string,
    input: {
      started: boolean;
      current: number;
      total: number;
      blockers: number;
      count: number;
      countLabel: string;
      primaryAction: string;
      path: string;
    },
  ): LifecycleStage => ({
    number,
    label,
    state: deriveLifecycleState(input),
    count: input.count,
    total: input.total,
    countLabel: input.countLabel,
    blockerCount: input.blockers,
    primaryAction: input.primaryAction,
    actionUrl: `/app/events/${eventId}${input.path}`,
  });

  return [
    stage(1, "Collect proposals", {
      started: snapshot.publishedForms > 0,
      current: snapshot.proposals > 0 ? 1 : 0,
      total: 1,
      blockers: 0,
      count: snapshot.proposals,
      countLabel: `${snapshot.proposals} submitted proposal${snapshot.proposals === 1 ? "" : "s"}`,
      primaryAction: "Manage CFP",
      path: "/cfp?lifecycle=collect-proposals",
    }),
    stage(2, "Review proposals", {
      started: snapshot.reviewAssignments > 0,
      current: snapshot.completedReviews,
      total: Math.max(snapshot.reviewAssignments, 1),
      blockers: snapshot.unassignedPending + snapshot.reviewConflicts,
      count: snapshot.completedReviews,
      countLabel: `${snapshot.completedReviews} of ${snapshot.reviewAssignments} assigned reviews complete`,
      primaryAction: "Assign reviewers",
      path: "/reviews?status=incomplete&lifecycle=review-proposals",
    }),
    stage(3, "Make decisions", {
      started: snapshot.finalDecisions + snapshot.stagedDecisions > 0,
      current: snapshot.finalDecisions,
      total: Math.max(snapshot.reviewedProposals, 1),
      blockers: 0,
      count: snapshot.finalDecisions,
      countLabel: `${snapshot.finalDecisions} of ${snapshot.reviewedProposals} reviewed proposals decided`,
      primaryAction: "Stage decision",
      path: "/submissions?decision=none&lifecycle=make-decisions",
    }),
    stage(4, "Prepare speakers", {
      started: snapshot.acceptedSpeakers > 0,
      current: snapshot.readySpeakers,
      total: Math.max(snapshot.acceptedSpeakers, 1),
      blockers: Math.max(0, snapshot.acceptedSpeakers - snapshot.readySpeakers),
      count: snapshot.readySpeakers,
      countLabel: `${snapshot.readySpeakers} of ${snapshot.acceptedSpeakers} accepted speakers ready`,
      primaryAction: "Prepare speakers",
      path: "/speakers?status=incomplete&lifecycle=prepare-speakers",
    }),
    stage(5, "Approve content", {
      started: snapshot.acceptedSessions > 0,
      current: snapshot.approvedSessions,
      total: Math.max(snapshot.acceptedSessions, 1),
      blockers: snapshot.needsChangesContent,
      count: snapshot.approvedSessions,
      countLabel: `${snapshot.approvedSessions} of ${snapshot.acceptedSessions} accepted sessions approved`,
      primaryAction: "Approve content",
      path: "/content?status=in_review&lifecycle=approve-content",
    }),
    stage(6, "Build the agenda", {
      started: snapshot.placedSessions > 0,
      current: snapshot.placedSessions,
      total: Math.max(snapshot.approvedSessions, 1),
      blockers: snapshot.openScheduleConflicts,
      count: snapshot.placedSessions,
      countLabel: `${snapshot.placedSessions} of ${snapshot.approvedSessions} approved sessions placed`,
      primaryAction: "Schedule session",
      path: "/agenda?status=unplaced&lifecycle=build-agenda",
    }),
    stage(7, "Publish the program", {
      started: snapshot.placedSessions > 0,
      current: snapshot.publishedSessions,
      total: Math.max(snapshot.placedSessions, 1),
      blockers: snapshot.openScheduleConflicts,
      count: snapshot.publishedSessions,
      countLabel: `${snapshot.publishedSessions} of ${snapshot.placedSessions} placed sessions published`,
      primaryAction: "Publish agenda",
      path: "/agenda?status=unpublished&lifecycle=publish-program",
    }),
  ];
}

export const lifecycleSnapshotSql = `
  SELECT
    (SELECT COUNT(*) FROM cfp_forms WHERE event_id=?1 AND published_at IS NOT NULL) AS publishedForms,
    (SELECT COUNT(*) FROM submissions WHERE event_id=?1 AND status!='draft') AS proposals,
    (SELECT COUNT(*) FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id WHERE rr.event_id=?1 AND ra.recused_at IS NULL) AS reviewAssignments,
    (SELECT COUNT(*) FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id WHERE rr.event_id=?1 AND ra.completed_at IS NOT NULL AND ra.recused_at IS NULL) AS completedReviews,
    (SELECT COUNT(*) FROM submissions s WHERE s.event_id=?1 AND s.status='pending' AND NOT EXISTS (SELECT 1 FROM review_assignments ra JOIN review_rounds rr ON rr.id=ra.round_id WHERE ra.submission_id=s.id AND rr.event_id=s.event_id AND ra.recused_at IS NULL)) AS unassignedPending,
    (SELECT COUNT(*) FROM review_conflicts WHERE event_id=?1 AND status='unresolved') AS reviewConflicts,
    (SELECT COUNT(DISTINCT s.id) FROM submissions s JOIN review_assignments ra ON ra.submission_id=s.id WHERE s.event_id=?1 AND ra.completed_at IS NOT NULL AND ra.recused_at IS NULL) AS reviewedProposals,
    (SELECT COUNT(*) FROM submissions s WHERE s.event_id=?1 AND s.decision_state IN ('accepted','waitlisted','rejected') AND EXISTS (SELECT 1 FROM review_assignments ra WHERE ra.submission_id=s.id AND ra.completed_at IS NOT NULL AND ra.recused_at IS NULL)) AS finalDecisions,
    (SELECT COUNT(*) FROM submissions WHERE event_id=?1 AND decision_state IN ('acceptance_staged','waitlist_staged','rejection_staged')) AS stagedDecisions,
    (SELECT COUNT(DISTINCT ss.speaker_id) FROM session_speakers ss JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id=?1 AND s.status='accepted' AND s.decision_state='accepted') AS acceptedSpeakers,
    (SELECT COUNT(DISTINCT sp.id) FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_id=sp.id JOIN submissions s ON s.id=ss.submission_id WHERE s.event_id=?1 AND s.status='accepted' AND s.decision_state='accepted' AND sp.portal_status IN ('active','complete') AND NOT EXISTS (SELECT 1 FROM speaker_task_assignments sta JOIN onboarding_tasks ot ON ot.id=sta.task_id WHERE sta.speaker_id=sp.id AND ot.event_id=s.event_id AND sta.status!='complete')) AS readySpeakers,
    (SELECT COUNT(*) FROM submissions WHERE event_id=?1 AND status='accepted' AND decision_state='accepted') AS acceptedSessions,
    (SELECT COUNT(*) FROM submissions s JOIN session_content_state cs ON cs.submission_id=s.id WHERE s.event_id=?1 AND s.status='accepted' AND s.decision_state='accepted' AND cs.status='approved') AS approvedSessions,
    (SELECT COUNT(*) FROM files f WHERE f.event_id=?1 AND f.status='needs_changes') AS needsChangesContent,
    (SELECT COUNT(DISTINCT ai.submission_id) FROM agenda_items ai JOIN submissions s ON s.id=ai.submission_id JOIN session_content_state cs ON cs.submission_id=s.id AND cs.status='approved' WHERE ai.event_id=?1 AND ai.starts_at IS NOT NULL AND ai.cancelled_at IS NULL AND s.status='accepted' AND s.decision_state='accepted') AS placedSessions,
    (SELECT COUNT(*) FROM schedule_conflict_records WHERE event_id=?1 AND status='open') AS openScheduleConflicts,
    (SELECT COUNT(DISTINCT ai.submission_id) FROM agenda_items ai JOIN submissions s ON s.id=ai.submission_id JOIN session_content_state cs ON cs.submission_id=s.id AND cs.status='approved' WHERE ai.event_id=?1 AND ai.status='published' AND ai.cancelled_at IS NULL AND s.status='accepted' AND s.decision_state='accepted') AS publishedSessions
`;
