import { useCallback, useEffect, useState } from "react";

export type LifecycleStageView = {
  number: number;
  label: string;
  state: "Not started" | "In progress" | "Blocked" | "Complete";
  count: number;
  total: number;
  countLabel: string;
  blockerCount: number;
  primaryAction: string;
  actionUrl: string;
};

export function EventLifecycleGuide({
  eventId,
  stages: suppliedStages,
  compact = false,
}: {
  eventId: string;
  stages?: LifecycleStageView[];
  compact?: boolean;
}) {
  const [loadedStages, setLoadedStages] = useState<LifecycleStageView[]>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (suppliedStages) return;
    try {
      const response = await fetch(`/api/control-room/events/${eventId}`);
      const result = (await response.json()) as {
        lifecycle?: LifecycleStageView[];
        error?: { message?: string };
      };
      if (!response.ok || !result.lifecycle)
        throw new Error(
          result.error?.message ?? "The event lifecycle could not be loaded.",
        );
      setLoadedStages(result.lifecycle);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The event lifecycle could not be loaded.",
      );
    }
  }, [eventId, suppliedStages]);

  useEffect(() => void load(), [load]);
  const stages = suppliedStages ?? loadedStages;

  return (
    <section
      className={`lifecycle-guide${compact ? " lifecycle-guide-compact" : ""}`}
      aria-label={compact ? "Program lifecycle summary" : "Program lifecycle"}
      aria-busy={!stages && !error}
    >
      <div className="lifecycle-guide-heading">
        <div>
          <p className="kicker">Live event lifecycle</p>
          <h2>
            {compact ? "Program readiness" : "From proposals to publication"}
          </h2>
        </div>
        <p>Every state and count comes from this event’s saved records.</p>
      </div>
      {error && (
        <div className="form-status form-status-error" role="alert">
          {error} <button onClick={() => void load()}>Try again</button>
        </div>
      )}
      {!stages && !error && (
        <div
          className="lifecycle-guide-loading"
          aria-label="Loading program lifecycle"
        >
          Loading lifecycle…
        </div>
      )}
      {stages && (
        <ol className="lifecycle-stage-list">
          {stages.map((stage) => (
            <li key={stage.number} data-state={stage.state}>
              <div className="lifecycle-stage-copy">
                <span className="lifecycle-stage-number" aria-hidden="true">
                  {stage.number}
                </span>
                <div>
                  <h3>{stage.label}</h3>
                  <span className="status-pill">{stage.state}</span>
                  <p>{stage.countLabel}</p>
                  {stage.blockerCount > 0 && (
                    <small>
                      {stage.blockerCount} blocking record
                      {stage.blockerCount === 1 ? "" : "s"}
                    </small>
                  )}
                </div>
              </div>
              <a className="button button-small" href={stage.actionUrl}>
                <span className="primary-action-label">Primary action:</span>{" "}
                {stage.primaryAction}
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
