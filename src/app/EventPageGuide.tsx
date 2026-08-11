import { ArrowRight, CircleHelp } from "lucide-react";
import type { EventLifecycleSurface } from "./EventLifecycleNav";

const guides: Partial<
  Record<
    EventLifecycleSurface,
    {
      stage: string;
      explanation: string;
      nextLabel: string;
      nextPath: string;
    }
  >
> = {
  cfp: {
    stage: "Step 1 · Collect proposals",
    explanation:
      "Build the form people will submit, then publish it when questions and deadlines are ready.",
    nextLabel: "Review incoming submissions",
    nextPath: "/submissions",
  },
  submissions: {
    stage: "Step 1 · Collect proposals",
    explanation:
      "Triage incoming ideas here. Assign reviewers before choosing an outcome; staging an outcome does not send email.",
    nextLabel: "Assign and track reviews",
    nextPath: "/reviews",
  },
  reviews: {
    stage: "Step 2 · Evaluate proposals",
    explanation:
      "Choose who evaluates each proposal, collect their scorecards, and use the completed evidence to make a decision.",
    nextLabel: "Prepare decisions and messages",
    nextPath: "/communications",
  },
  communications: {
    stage: "Step 3 · Decide and communicate",
    explanation:
      "Staging records the organizer's decision without contacting anyone. Preview recipients and content here before sending.",
    nextLabel: "Prepare accepted speakers",
    nextPath: "/speakers",
  },
  speakers: {
    stage: "Step 4 · Prepare speakers",
    explanation:
      "Invite accepted speakers, track portal access and onboarding, and see exactly who still needs help.",
    nextLabel: "Review content and files",
    nextPath: "/content",
  },
  content: {
    stage: "Step 4 · Prepare speakers",
    explanation:
      "Review uploaded files and session content. Only approved work can move safely into the public program.",
    nextLabel: "Schedule approved sessions",
    nextPath: "/agenda",
  },
  agenda: {
    stage: "Step 5 · Schedule",
    explanation:
      "Place approved sessions into rooms and times, resolve collisions, then publish the schedule for attendees.",
    nextLabel: "Manage calendar invitations",
    nextPath: "/calendar",
  },
  calendar: {
    stage: "Step 5 · Schedule",
    explanation:
      "Send participant invitations and update the same calendar event when time, room, or session details change.",
    nextLabel: "Open public attendee views",
    nextPath: "/widgets",
  },
  widgets: {
    stage: "Step 6 · Publish",
    explanation:
      "Configure the five live attendee views. Changes follow the approved, published agenda without rebuilding embeds.",
    nextLabel: "Return to the Control Room",
    nextPath: "/control-room",
  },
};

export function EventPageGuide({
  eventId,
  surface,
}: {
  eventId: string;
  surface: EventLifecycleSurface;
}) {
  const guide = guides[surface];
  if (!guide) return null;
  return (
    <section
      className="event-page-guide"
      aria-label="Where this fits in the program lifecycle"
    >
      <CircleHelp size={18} aria-hidden="true" />
      <div>
        <strong>{guide.stage}</strong>
        <p>{guide.explanation}</p>
      </div>
      <a href={`/app/events/${eventId}${guide.nextPath}`}>
        Next: {guide.nextLabel} <ArrowRight size={15} aria-hidden="true" />
      </a>
    </section>
  );
}
