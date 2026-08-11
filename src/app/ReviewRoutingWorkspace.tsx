import {
  AlertTriangle,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Option = { id: string; name: string; email?: string; color?: string };
type Field = Option & {
  formId: string;
  fieldKey: string;
  fieldType: string;
  options?: string[];
};
type Condition = {
  source: "form" | "track" | "format" | "tag" | "custom_field";
  fieldId: string | null;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "in"
    | "is_set"
    | "is_not_set";
  value: unknown;
};
type Group = {
  conditionOperator: "and" | "or";
  conditions: Condition[];
};
type Rule = {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  groupOperator: "and" | "or";
  roundId: string;
  roundName: string;
  reviewersPerSubmission: number;
  ownerUserId: string | null;
  ownerName: string | null;
  excludedReviewerIds: string[];
  tagIds: string[];
  groups: Group[];
};
type Preview = {
  submissions: Array<{
    submissionId: string;
    submissionTitle: string;
    matchedRuleIds: string[];
    selectedRuleId: string | null;
    eligibleReviewerIds: string[];
    excludedReviewerIds: string[];
  }>;
  diagnostics: Array<{
    type: "overlap" | "contradiction" | "unmatched";
    message: string;
    submissionId?: string;
  }>;
};
type RuleDraft = {
  id?: string;
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  groupOperator: "and" | "or";
  roundId: string;
  reviewersPerSubmission: number;
  ownerUserId: string;
  excludedReviewerIds: string[];
  tagIds: string[];
  groups: Group[];
};
type RoutingData = {
  rules: Rule[];
  preview: Preview;
  rounds: Array<Option & { status: string }>;
  reviewers: Option[];
  forms: Option[];
  tracks: Option[];
  tags: Option[];
  fields: Field[];
  owners: Option[];
  runs: Array<{
    id: string;
    triggerType: string;
    submissionCount: number;
    matchedCount: number;
    assignmentCount: number;
    skippedConflictCount: number;
    skippedCapacityCount: number;
    unmatchedCount: number;
    status: string;
    startedAt: string;
  }>;
};

const emptyCondition = (): Condition => ({
  source: "track",
  fieldId: null,
  operator: "equals",
  value: "",
});
const emptyGroup = (): Group => ({
  conditionOperator: "and",
  conditions: [emptyCondition()],
});
const emptyDraft = (): RuleDraft => ({
  id: undefined as string | undefined,
  name: "",
  description: "",
  priority: 100,
  enabled: true,
  groupOperator: "and",
  roundId: "",
  reviewersPerSubmission: 2,
  ownerUserId: "",
  excludedReviewerIds: [] as string[],
  tagIds: [] as string[],
  groups: [emptyGroup()],
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(body.error?.message ?? "Routing could not be updated.");
  return body;
}

export function ReviewRoutingWorkspace({ eventId }: { eventId: string }) {
  const [data, setData] = useState<RoutingData>();
  const [draft, setDraft] = useState(emptyDraft);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteRuleId, setDeleteRuleId] = useState<string>();
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  }>();

  async function load() {
    const result = await api<Partial<RoutingData>>(
      `/api/review-routing/events/${eventId}`,
    );
    setData({
      rules: result.rules ?? [],
      preview: result.preview ?? { submissions: [], diagnostics: [] },
      rounds: result.rounds ?? [],
      reviewers: result.reviewers ?? [],
      forms: result.forms ?? [],
      tracks: result.tracks ?? [],
      tags: result.tags ?? [],
      fields: result.fields ?? [],
      owners: result.owners ?? [],
      runs: result.runs ?? [],
    });
  }
  useEffect(() => {
    load().catch((error: Error) =>
      setFeedback({ kind: "error", message: error.message }),
    );
  }, [eventId]);

  const names = useMemo(
    () =>
      new Map(
        [
          ...(data?.forms ?? []),
          ...(data?.tracks ?? []),
          ...(data?.tags ?? []),
          ...(data?.fields ?? []),
        ].map((item) => [item.id, item.name]),
      ),
    [data],
  );

  function editRule(rule: Rule) {
    setDraft({
      id: rule.id,
      name: rule.name,
      description: rule.description ?? "",
      priority: rule.priority,
      enabled: rule.enabled,
      groupOperator: rule.groupOperator,
      roundId: rule.roundId,
      reviewersPerSubmission: rule.reviewersPerSubmission,
      ownerUserId: rule.ownerUserId ?? "",
      excludedReviewerIds: rule.excludedReviewerIds,
      tagIds: rule.tagIds,
      groups: rule.groups.map((group) => ({
        conditionOperator: group.conditionOperator,
        conditions: group.conditions.map((condition) => ({
          source: condition.source,
          fieldId: condition.fieldId,
          operator: condition.operator,
          value: condition.value,
        })),
      })),
    });
    setOpen(true);
    setFeedback(undefined);
  }

  async function save() {
    setBusy(true);
    try {
      const path = draft.id
        ? `/api/review-routing/events/${eventId}/rules/${draft.id}`
        : `/api/review-routing/events/${eventId}/rules`;
      await api(path, {
        method: draft.id ? "PUT" : "POST",
        body: JSON.stringify({
          ...draft,
          description: draft.description || null,
          ownerUserId: draft.ownerUserId || null,
          groups: draft.groups.map((group) => ({
            ...group,
            conditions: group.conditions.map((condition) => ({
              ...condition,
              fieldId:
                condition.source === "custom_field" ? condition.fieldId : null,
              value: ["is_set", "is_not_set"].includes(condition.operator)
                ? null
                : condition.value,
            })),
          })),
        }),
      });
      await load();
      setOpen(false);
      setDraft(emptyDraft());
      setFeedback({
        kind: "success",
        message:
          "Routing rule saved. Preview current proposals, then choose Run routing to apply it now. New submissions route automatically.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Rule not saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function runRouting() {
    setBusy(true);
    try {
      const result = await api<{
        result: {
          submissionCount: number;
          matchedCount: number;
          assignmentCount: number;
          skippedConflictCount: number;
          skippedCapacityCount: number;
          unmatchedCount: number;
        };
      }>(`/api/review-routing/events/${eventId}/run`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
      const summary = result.result;
      setFeedback({
        kind: "success",
        message: `Routing finished: ${summary.matchedCount}/${summary.submissionCount} proposals matched, ${summary.assignmentCount} assignments created, ${summary.skippedConflictCount} conflicts and ${summary.skippedCapacityCount} capacity limits safely skipped, ${summary.unmatchedCount} unmatched.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Routing failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(ruleId: string) {
    setBusy(true);
    try {
      await api(`/api/review-routing/events/${eventId}/rules/${ruleId}`, {
        method: "DELETE",
      });
      await load();
      setDeleteRuleId(undefined);
      setFeedback({
        kind: "success",
        message:
          "Routing rule deleted. Existing review assignments remain; future runs no longer use this rule.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Rule not deleted.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <section className="routing-workspace" aria-busy="true">
        Loading submission routing…
      </section>
    );

  const unmatched = data.preview.diagnostics.filter(
    (item) => item.type === "unmatched",
  ).length;
  const overlaps = data.preview.diagnostics.filter(
    (item) => item.type === "overlap",
  ).length;
  const contradictions = data.preview.diagnostics.filter(
    (item) => item.type === "contradiction",
  ).length;

  return (
    <section className="routing-workspace" aria-labelledby="routing-title">
      <header className="routing-heading">
        <div>
          <p className="kicker">Automatic reviewer routing</p>
          <h2 id="routing-title">
            Send each proposal to the right review path.
          </h2>
          <p>
            Rules evaluate form, track, format, tags, and custom CFP answers in
            priority order. Capacity, recusals, and conflicts are always checked
            before an assignment is created.
          </p>
        </div>
        <div className="inline-actions">
          <button
            className="button button-ghost button-small"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={14} /> Refresh preview
          </button>
          <button
            className="button button-small"
            onClick={() => {
              setDraft(emptyDraft());
              setOpen(true);
            }}
          >
            <Plus size={14} /> Create routing rule
          </button>
          <button
            className="button button-small"
            onClick={() => void runRouting()}
            disabled={busy || !data.rules.length}
          >
            <Play size={14} /> Run routing
          </button>
        </div>
      </header>
      {feedback && (
        <div
          className={`form-status form-status-${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </div>
      )}
      <div className="routing-summary" aria-label="Routing preview summary">
        <article>
          <strong>{data.rules.length}</strong>
          <span>rules</span>
        </article>
        <article>
          <strong>{data.preview.submissions.length - unmatched}</strong>
          <span>proposals matched</span>
        </article>
        <article className={unmatched ? "warning" : "clear"}>
          <strong>{unmatched}</strong>
          <span>without a route</span>
        </article>
        <article className={overlaps || contradictions ? "warning" : "clear"}>
          <strong>{overlaps + contradictions}</strong>
          <span>rule warnings</span>
        </article>
      </div>
      {data.preview.diagnostics.length > 0 && (
        <div className="routing-diagnostics">
          <h3>
            <AlertTriangle size={16} /> Preview warnings
          </h3>
          <ul>
            {data.preview.diagnostics.slice(0, 20).map((item, index) => (
              <li key={`${item.type}-${item.submissionId ?? index}`}>
                <strong>{item.type.replace("_", " ")}</strong> {item.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section
        className="routing-impact"
        aria-labelledby="routing-impact-title"
      >
        <div>
          <h3 id="routing-impact-title">Current proposal impact</h3>
          <p>
            This is a read-only preview. Run routing only after the proposals,
            winning rule, and eligible reviewer pool look right.
          </p>
        </div>
        <div className="routing-impact-list">
          {data.preview.submissions.slice(0, 50).map((submission) => {
            const selectedRule = data.rules.find(
              (rule) => rule.id === submission.selectedRuleId,
            );
            const eligible = submission.eligibleReviewerIds
              .map(
                (id) =>
                  data.reviewers.find((reviewer) => reviewer.id === id)?.name,
              )
              .filter(Boolean);
            return (
              <article key={submission.submissionId}>
                <div>
                  <a
                    href={`/app/events/${eventId}/submissions/${submission.submissionId}`}
                  >
                    {submission.submissionTitle}
                  </a>
                  <small>
                    {selectedRule
                      ? `${selectedRule.name} wins at priority ${selectedRule.priority}`
                      : "No matching route"}
                  </small>
                </div>
                <span>
                  {eligible.length
                    ? `${eligible.join(", ")} eligible`
                    : "No eligible reviewer"}
                </span>
                {submission.excludedReviewerIds.length > 0 && (
                  <small>
                    {submission.excludedReviewerIds.length} reviewer
                    {submission.excludedReviewerIds.length === 1
                      ? ""
                      : "s"}{" "}
                    safely excluded by capacity or conflict checks
                  </small>
                )}
              </article>
            );
          })}
          {!data.preview.submissions.length && (
            <div className="inline-empty">
              No submitted proposals to preview yet. Publish a CFP and submit a
              proposal, then return here to verify its route.
            </div>
          )}
        </div>
      </section>
      <div className="routing-rule-list">
        {data.rules.map((rule) => (
          <article key={rule.id}>
            <div className="routing-rule-priority">
              Priority {rule.priority}
            </div>
            <div>
              <h3>{rule.name}</h3>
              <p>{plainLanguageRule(rule, data, names)}</p>
              <small>
                {rule.enabled ? "Active" : "Paused"} · {rule.roundName} ·{" "}
                {rule.reviewersPerSubmission} reviewer
                {rule.reviewersPerSubmission === 1 ? "" : "s"} per proposal
                {rule.ownerName ? ` · owner ${rule.ownerName}` : ""}
              </small>
            </div>
            <div className="inline-actions">
              <button
                className="button button-ghost button-small"
                onClick={() => editRule(rule)}
              >
                Edit rule
              </button>
              {deleteRuleId !== rule.id ? (
                <button
                  className="button button-ghost button-small"
                  onClick={() => setDeleteRuleId(rule.id)}
                >
                  <Trash2 size={13} /> Delete rule
                </button>
              ) : (
                <div
                  className="routing-delete-confirm"
                  role="group"
                  aria-label={`Confirm deletion of ${rule.name}`}
                >
                  <span>
                    Existing assignments stay. Future routing stops using this
                    rule.
                  </span>
                  <button
                    className="button button-danger button-small"
                    onClick={() => void removeRule(rule.id)}
                    disabled={busy}
                  >
                    Confirm delete
                  </button>
                  <button
                    className="button button-ghost button-small"
                    onClick={() => setDeleteRuleId(undefined)}
                  >
                    Keep rule
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
        {!data.rules.length && (
          <div className="builder-empty">
            <GitBranch size={30} />
            <h3>No routing rules yet</h3>
            <p>
              Create a rule to automatically place new proposals into a review
              round and its eligible reviewer pool.
            </p>
            <button
              className="button button-small"
              onClick={() => setOpen(true)}
            >
              Create routing rule
            </button>
          </div>
        )}
      </div>
      {data.runs[0] && (
        <p className="routing-last-run">
          Last run {new Date(data.runs[0].startedAt).toLocaleString()}:{" "}
          {data.runs[0].assignmentCount} assignments,{" "}
          {data.runs[0].unmatchedCount} unmatched,{" "}
          {data.runs[0].skippedConflictCount} conflicts skipped,{" "}
          {data.runs[0].skippedCapacityCount} capacity limits skipped.
        </p>
      )}
      {open && (
        <div
          className="routing-builder"
          role="region"
          aria-label="Routing rule builder"
        >
          <header>
            <div>
              <p className="kicker">Plain-language rule builder</p>
              <h3>{draft.id ? "Edit routing rule" : "Create routing rule"}</h3>
            </div>
            <button
              className="button button-ghost button-small"
              onClick={() => setOpen(false)}
              aria-label="Close routing rule builder"
            >
              <X size={14} /> Close
            </button>
          </header>
          <div className="routing-builder-grid">
            <label>
              Rule name
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="AI Engineering workshops"
              />
            </label>
            <label>
              Priority <small>Lower numbers run first</small>
              <input
                type="number"
                min="0"
                max="10000"
                value={draft.priority}
                onChange={(event) =>
                  setDraft({ ...draft, priority: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Review round
              <select
                value={draft.roundId}
                onChange={(event) =>
                  setDraft({ ...draft, roundId: event.target.value })
                }
              >
                <option value="">Choose a round</option>
                {data.rounds.map((round) => (
                  <option value={round.id} key={round.id}>
                    {round.name} · {round.status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reviewers per proposal
              <input
                type="number"
                min="1"
                max="20"
                value={draft.reviewersPerSubmission}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    reviewersPerSubmission: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Owner <small>Optional operational owner</small>
              <select
                value={draft.ownerUserId}
                onChange={(event) =>
                  setDraft({ ...draft, ownerUserId: event.target.value })
                }
              >
                <option value="">No owner</option>
                {data.owners.map((owner) => (
                  <option value={owner.id} key={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft({ ...draft, enabled: event.target.checked })
                }
              />
              <span>
                <strong>Rule active</strong>
                <small>Evaluate new submissions automatically.</small>
              </span>
            </label>
            <label className="wide">
              Description
              <textarea
                rows={2}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="Why this route exists and who owns it."
              />
            </label>
          </div>
          <div className="routing-logic-heading">
            <strong>Match proposal when</strong>
            <select
              aria-label="Operator between condition groups"
              value={draft.groupOperator}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  groupOperator: event.target.value as "and" | "or",
                })
              }
            >
              <option value="and">every condition group matches</option>
              <option value="or">any condition group matches</option>
            </select>
          </div>
          <div className="routing-groups">
            {draft.groups.map((group, groupIndex) => (
              <fieldset key={groupIndex}>
                <legend>Condition group {groupIndex + 1}</legend>
                <label>
                  Inside this group
                  <select
                    value={group.conditionOperator}
                    onChange={(event) =>
                      updateGroup(draft, setDraft, groupIndex, {
                        ...group,
                        conditionOperator: event.target.value as "and" | "or",
                      })
                    }
                  >
                    <option value="and">all conditions must match</option>
                    <option value="or">any condition may match</option>
                  </select>
                </label>
                {group.conditions.map((condition, conditionIndex) => (
                  <div className="routing-condition" key={conditionIndex}>
                    <label>
                      Attribute
                      <select
                        aria-label={`Attribute for group ${groupIndex + 1}, condition ${conditionIndex + 1}`}
                        value={condition.source}
                        onChange={(event) =>
                          updateCondition(
                            draft,
                            setDraft,
                            groupIndex,
                            conditionIndex,
                            {
                              ...condition,
                              source: event.target.value as Condition["source"],
                              fieldId: null,
                              value: "",
                            },
                          )
                        }
                      >
                        <option value="form">CFP form</option>
                        <option value="track">Track</option>
                        <option value="format">Format</option>
                        <option value="tag">Tag</option>
                        <option value="custom_field">Custom CFP field</option>
                      </select>
                    </label>
                    {condition.source === "custom_field" && (
                      <label>
                        Custom field
                        <select
                          value={condition.fieldId ?? ""}
                          onChange={(event) =>
                            updateCondition(
                              draft,
                              setDraft,
                              groupIndex,
                              conditionIndex,
                              { ...condition, fieldId: event.target.value },
                            )
                          }
                        >
                          <option value="">Choose a field</option>
                          {data.fields.map((field) => (
                            <option value={field.id} key={field.id}>
                              {field.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      Comparison
                      <select
                        value={condition.operator}
                        onChange={(event) =>
                          updateCondition(
                            draft,
                            setDraft,
                            groupIndex,
                            conditionIndex,
                            {
                              ...condition,
                              operator: event.target
                                .value as Condition["operator"],
                            },
                          )
                        }
                      >
                        <option value="equals">equals</option>
                        <option value="not_equals">does not equal</option>
                        <option value="contains">contains</option>
                        <option value="not_contains">does not contain</option>
                        <option value="in">is one of</option>
                        <option value="is_set">is answered</option>
                        <option value="is_not_set">is unanswered</option>
                      </select>
                    </label>
                    {!["is_set", "is_not_set"].includes(condition.operator) && (
                      <ConditionValue
                        condition={condition}
                        data={data}
                        update={(value) =>
                          updateCondition(
                            draft,
                            setDraft,
                            groupIndex,
                            conditionIndex,
                            { ...condition, value },
                          )
                        }
                      />
                    )}
                    <button
                      className="button button-ghost button-small"
                      aria-label={`Remove condition ${conditionIndex + 1} from group ${groupIndex + 1}`}
                      onClick={() => {
                        const conditions = group.conditions.filter(
                          (_, index) => index !== conditionIndex,
                        );
                        if (conditions.length)
                          updateGroup(draft, setDraft, groupIndex, {
                            ...group,
                            conditions,
                          });
                      }}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                ))}
                <button
                  className="button button-ghost button-small"
                  onClick={() =>
                    updateGroup(draft, setDraft, groupIndex, {
                      ...group,
                      conditions: [...group.conditions, emptyCondition()],
                    })
                  }
                >
                  <Plus size={13} /> Add condition
                </button>
              </fieldset>
            ))}
            <button
              className="button button-ghost button-small"
              onClick={() =>
                setDraft({ ...draft, groups: [...draft.groups, emptyGroup()] })
              }
            >
              <Plus size={13} /> Add condition group
            </button>
          </div>
          <div className="routing-actions-grid">
            <fieldset>
              <legend>Exclude reviewers</legend>
              {data.reviewers.map((reviewer) => (
                <label className="check-row" key={reviewer.id}>
                  <input
                    type="checkbox"
                    checked={draft.excludedReviewerIds.includes(reviewer.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        excludedReviewerIds: event.target.checked
                          ? [...draft.excludedReviewerIds, reviewer.id]
                          : draft.excludedReviewerIds.filter(
                              (id) => id !== reviewer.id,
                            ),
                      })
                    }
                  />
                  <span>
                    <strong>{reviewer.name}</strong>
                    <small>{reviewer.email}</small>
                  </span>
                </label>
              ))}
              {!data.reviewers.length && <p>No reviewers invited yet.</p>}
            </fieldset>
            <fieldset>
              <legend>Apply tags</legend>
              {data.tags.map((tag) => (
                <label className="check-row" key={tag.id}>
                  <input
                    type="checkbox"
                    checked={draft.tagIds.includes(tag.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tagIds: event.target.checked
                          ? [...draft.tagIds, tag.id]
                          : draft.tagIds.filter((id) => id !== tag.id),
                      })
                    }
                  />
                  <span>
                    <strong>{tag.name}</strong>
                    <small>Added when this rule applies.</small>
                  </span>
                </label>
              ))}
              {!data.tags.length && <p>Create submission tags first.</p>}
            </fieldset>
          </div>
          <div className="routing-builder-footer">
            <p>
              Saving changes affects future automatic routing. Existing
              assignments change only when you explicitly choose Run routing,
              and reruns never duplicate assignments.
            </p>
            <button
              className="button"
              onClick={() => void save()}
              disabled={busy || !draft.name || !draft.roundId}
            >
              <Save size={15} /> Save routing rule
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ConditionValue({
  condition,
  data,
  update,
}: {
  condition: Condition;
  data: RoutingData;
  update: (value: string) => void;
}) {
  const options =
    condition.source === "form"
      ? data.forms
      : condition.source === "track"
        ? data.tracks
        : condition.source === "tag"
          ? data.tags
          : null;
  if (options)
    return (
      <label>
        Value
        <select
          value={String(condition.value ?? "")}
          onChange={(event) => update(event.target.value)}
        >
          <option value="">Choose a value</option>
          {options.map((option) => (
            <option value={option.id} key={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    );
  const field = data.fields.find((item) => item.id === condition.fieldId);
  if (condition.source === "custom_field" && field?.options?.length)
    return (
      <label>
        Value
        <select
          value={String(condition.value ?? "")}
          onChange={(event) => update(event.target.value)}
        >
          <option value="">Choose a value</option>
          {field.options.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <label>
      Value
      <input
        value={String(condition.value ?? "")}
        onChange={(event) => update(event.target.value)}
        placeholder={condition.source === "format" ? "Workshop" : "Value"}
      />
    </label>
  );
}

function updateGroup(
  draft: ReturnType<typeof emptyDraft>,
  setDraft: (draft: ReturnType<typeof emptyDraft>) => void,
  groupIndex: number,
  group: Group,
) {
  const groups = [...draft.groups];
  groups[groupIndex] = group;
  setDraft({ ...draft, groups });
}

function updateCondition(
  draft: ReturnType<typeof emptyDraft>,
  setDraft: (draft: ReturnType<typeof emptyDraft>) => void,
  groupIndex: number,
  conditionIndex: number,
  condition: Condition,
) {
  const group = draft.groups[groupIndex];
  const conditions = [...group.conditions];
  conditions[conditionIndex] = condition;
  updateGroup(draft, setDraft, groupIndex, { ...group, conditions });
}

function plainLanguageRule(
  rule: Rule,
  data: RoutingData,
  names: Map<string, string>,
) {
  const groups = rule.groups.map((group) =>
    group.conditions
      .map((condition) => {
        const attribute =
          condition.source === "custom_field"
            ? (names.get(condition.fieldId ?? "") ?? "custom field")
            : condition.source.replace("_", " ");
        const value =
          names.get(String(condition.value ?? "")) ??
          String(condition.value ?? "");
        return `${attribute} ${condition.operator.replaceAll("_", " ")}${value ? ` “${value}”` : ""}`;
      })
      .join(` ${group.conditionOperator.toUpperCase()} `),
  );
  const tags = rule.tagIds
    .map((id) => data.tags.find((tag) => tag.id === id)?.name)
    .filter(Boolean);
  return `When ${groups.join(` ${rule.groupOperator.toUpperCase()} `)}, assign up to ${rule.reviewersPerSubmission} eligible reviewer${rule.reviewersPerSubmission === 1 ? "" : "s"} from ${rule.roundName}${tags.length ? ` and apply ${tags.join(", ")}` : ""}.`;
}
