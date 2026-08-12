import type { Ref } from "react";

export type MutationFeedback = {
  kind: "success" | "error";
  message: string;
};

export function inferDurableState(message: string) {
  const value = message.toLowerCase();
  if (value.includes("nothing was sent") || value.includes("staged"))
    return "Decision staged — nothing sent";
  if (value.includes("delivered")) return "Delivered";
  if (value.includes("queued") || value.includes("sending"))
    return "Queued for delivery";
  if (value.includes("cancel")) return "Cancelled";
  if (value.includes("publish")) return "Published";
  if (value.includes("approv")) return "Approved";
  if (value.includes("schedule") || value.includes("placed"))
    return "Scheduled";
  if (value.includes("upload")) return "Uploaded";
  if (value.includes("invit")) return "Invited";
  if (value.includes("complete")) return "Complete";
  if (value.includes("submitted")) return "Submitted";
  return "Saved";
}

export function MutationResultPanel({
  feedback,
  nextAction,
  focusRef,
}: {
  feedback: MutationFeedback;
  nextAction: { label: string; href: string };
  focusRef?: Ref<HTMLDivElement>;
}) {
  if (feedback.kind === "error")
    return (
      <div
        ref={focusRef}
        className="form-status form-status-error"
        role="alert"
        tabIndex={-1}
      >
        {feedback.message}
      </div>
    );
  return (
    <div
      ref={focusRef}
      className="mutation-result-panel"
      role="status"
      aria-live="polite"
      tabIndex={-1}
    >
      <h2>Change saved</h2>
      <dl>
        <div>
          <dt>What changed</dt>
          <dd>{feedback.message}</dd>
        </div>
        <div>
          <dt>New durable state</dt>
          <dd>{inferDurableState(feedback.message)}</dd>
        </div>
      </dl>
      <div className="mutation-next-action">
        <span>Next recommended action</span>
        <a className="button button-small" href={nextAction.href}>
          {nextAction.label}
        </a>
      </div>
    </div>
  );
}
