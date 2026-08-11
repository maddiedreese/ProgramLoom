import type { CommunicationCategory } from "./operations";

export type DefaultCommunicationTemplate = {
  category: CommunicationCategory;
  name: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
};

const definitions: Array<[CommunicationCategory, string, string, string]> = [
  [
    "submission_confirmation",
    "Submission confirmation",
    "We received {{submission.title}} for {{event.name}}",
    "Your proposal is now in the review queue. You can review or edit it here: {{submission.edit_link}}",
  ],
  [
    "draft_reminder",
    "Draft reminder",
    "Finish your {{event.name}} proposal",
    "Your draft, {{submission.title}}, has not been submitted yet. Continue here: {{submission.edit_link}}",
  ],
  [
    "deadline_reminder",
    "CFP deadline reminder",
    "{{event.name}} proposals close soon",
    "The call for proposals closes {{event.cfp_closes_at}}. Review your proposal here: {{submission.edit_link}}",
  ],
  [
    "reviewer_invitation",
    "Reviewer invitation",
    "Review proposals for {{event.name}}",
    "You have been invited to review {{event.name}} proposals. Open your review queue: {{review.queue_link}}",
  ],
  [
    "reviewer_reminder",
    "Reviewer reminder",
    "{{review.incomplete_count}} reviews remain for {{event.name}}",
    "Please complete your assigned reviews by {{review.due_at}}: {{review.queue_link}}",
  ],
  [
    "change_request",
    "Change request",
    "Changes requested for {{session.title}}",
    "The program team requested changes. Review the request in your speaker portal: {{speaker.portal_link}}",
  ],
  [
    "decision_acceptance",
    "Acceptance decision",
    "{{submission.title}} is accepted for {{event.name}}",
    "We are delighted to include your session. Continue in your speaker portal: {{speaker.portal_link}}",
  ],
  [
    "decision_waitlist",
    "Waitlist decision",
    "An update on {{submission.title}}",
    "Your proposal is currently on the {{event.name}} waitlist. We will contact you when program space changes.",
  ],
  [
    "decision_rejection",
    "Rejection decision",
    "An update on {{submission.title}}",
    "Thank you for sharing your work with {{event.name}}. We are unable to include this proposal in the current program.",
  ],
  [
    "speaker_invitation",
    "Speaker portal invitation",
    "Your {{event.name}} speaker portal",
    "Complete your profile, tasks, and deliverables here: {{speaker.portal_link}}",
  ],
  [
    "onboarding_reminder",
    "Onboarding reminder",
    "{{task.incomplete_count}} speaker tasks remain for {{event.name}}",
    "Your next task is {{task.title}}, due {{task.due_at}}. Open your portal: {{speaker.portal_link}}",
  ],
  [
    "content_reminder",
    "Content reminder",
    "Content needed for {{session.title}}",
    "Please upload or revise {{file.request_name}} by {{file.due_at}}: {{speaker.portal_link}}",
  ],
  [
    "scheduling_notice",
    "Scheduling notice",
    "{{session.title}} has been scheduled",
    "Your session is scheduled for {{session.starts_at}} in {{session.room}}. View your portal: {{speaker.portal_link}}",
  ],
  [
    "calendar_invitation",
    "Calendar invitation",
    "Calendar invitation: {{session.title}}",
    "A calendar invitation is attached for {{session.starts_at}} in {{session.room}}.",
  ],
  [
    "calendar_update",
    "Calendar update",
    "Updated schedule: {{session.title}}",
    "The attached invitation updates your session to {{session.starts_at}} in {{session.room}}.",
  ],
  [
    "calendar_cancellation",
    "Calendar cancellation",
    "Cancelled: {{session.title}}",
    "The attached calendar message cancels the previous invitation for this session.",
  ],
  [
    "speaker_message",
    "Organizer message",
    "A message from the {{event.name}} team",
    "Hi {{speaker.first_name}},\n\n{{organizer.message}}\n\nOpen your speaker portal: {{speaker.portal_link}}",
  ],
  [
    "crm_outreach",
    "Event outreach",
    "An invitation from {{event.name}}",
    "{{organizer.message}}\n\nLearn more: {{event.public_url}}",
  ],
];

export const defaultCommunicationTemplates: DefaultCommunicationTemplate[] =
  definitions.map(([category, name, subject, bodyText]) => ({
    category,
    name,
    subject,
    bodyText,
    bodyHtml: bodyText
      .split("\n")
      .map((line) => `<p>${line || "&nbsp;"}</p>`)
      .join(""),
  }));

export const supportedCommunicationMergeFields = [
  "recipient.name",
  "recipient.email",
  "organization.name",
  "event.name",
  "event.starts_at",
  "event.ends_at",
  "event.timezone",
  "event.cfp_closes_at",
  "event.public_url",
  "submission.title",
  "submission.status",
  "submission.edit_link",
  "review.round",
  "review.due_at",
  "review.incomplete_count",
  "review.queue_link",
  "speaker.portal_link",
  "speaker.first_name",
  "speaker.last_name",
  "speaker.company",
  "task.title",
  "task.due_at",
  "task.incomplete_count",
  "file.request_name",
  "file.due_at",
  "session.title",
  "session.starts_at",
  "session.ends_at",
  "session.room",
  "organizer.message",
] as const;
