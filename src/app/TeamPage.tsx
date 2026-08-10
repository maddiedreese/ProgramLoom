import { ArrowRight, LoaderCircle, Mail, UsersRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

type User = { id: string; email: string; name: string };
type Organization = { id: string; name: string; role: string };
type EventRecord = { id: string; name: string };
type Member = {
  id: string;
  email: string;
  name: string;
  organizationRole: string;
  joinedAt: string;
};
type EventRole = {
  userId: string;
  eventId: string;
  eventName: string;
  role: string;
};
type PendingInvite = {
  id: string;
  email: string;
  role: string;
  eventId: string | null;
  eventName: string | null;
  expiresAt: string;
};

export function invitationDeliveryMessage(
  deliveryStatus: "prepared" | "queued" | "sent",
  email: string,
) {
  if (deliveryStatus === "queued")
    return `Invitation created and queued for ${email}. Provider delivery evidence will appear in Communications.`;
  if (deliveryStatus === "prepared")
    return `Invitation created for ${email}, but delivery is only prepared. Open Communications to retry or inspect it.`;
  return `The email provider accepted the workspace invitation for ${email}. Delivery is not claimed without provider evidence.`;
}

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

export function TeamPage({ user }: { user: User }) {
  const query = new URLSearchParams(window.location.search);
  const requestedOrganizationId = query.get("organization") ?? "";
  const requestedEventId = query.get("eventId") ?? "";
  const requestedRole = query.get("invite");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [eventRoles, setEventRoles] = useState<EventRole[]>([]);
  const [invitations, setInvitations] = useState<PendingInvite[]>([]);
  const [role, setRole] = useState<"admin" | "reviewer" | "speaker">(
    requestedRole === "speaker" ? "speaker" : "reviewer",
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  }>();

  useEffect(() => {
    api<{ organizations: Organization[] }>("/api/organizations")
      .then(({ organizations: items }) => {
        setOrganizations(items);
        setOrganizationId(
          items.some((item) => item.id === requestedOrganizationId)
            ? requestedOrganizationId
            : (items[0]?.id ?? ""),
        );
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      );
  }, []);
  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      api<{ events: EventRecord[] }>(
        `/api/organizations/${organizationId}/events`,
      ),
      api<{
        members: Member[];
        eventRoles: EventRole[];
        invitations: PendingInvite[];
      }>(`/api/organizations/${organizationId}/members`),
    ])
      .then(([eventResult, teamResult]) => {
        setEvents(eventResult.events);
        setMembers(teamResult.members);
        setEventRoles(teamResult.eventRoles);
        setInvitations(teamResult.invitations);
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [organizationId]);
  useEffect(() => {
    if (!members.length || !window.location.hash) return;
    const target = document.getElementById(window.location.hash.slice(1));
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [members]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const { invitation, deliveryStatus } = await api<{
        invitation: PendingInvite;
        deliveryStatus: "prepared" | "queued" | "sent";
      }>(`/api/organizations/${organizationId}/invitations`, {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          role,
          eventId: role === "admin" ? undefined : form.get("eventId"),
        }),
      });
      setInvitations((current) => [invitation, ...current]);
      formElement.reset();
      setFeedback({
        kind: "success",
        message: invitationDeliveryMessage(deliveryStatus, invitation.email),
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not create the invitation.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const selected = organizations.find(
    (organization) => organization.id === organizationId,
  );
  return (
    <div className="team-shell">
      <header className="team-topbar">
        <a href="/app" className="wordmark">
          <span aria-hidden="true" className="mark">
            PL
          </span>
          ProgramLoom
        </a>
        <nav>
          <a href="/app">Events</a>
          <a className="active" href="/app/team">
            Team
          </a>
        </nav>
        <span>{user.name}</span>
      </header>
      <main id="main-content" className="team-main">
        <div className="team-heading">
          <div>
            <p className="kicker">People and access</p>
            <h1>Team</h1>
            <p>Invite each person only to the work they need.</p>
          </div>
          <label>
            Workspace
            <select
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              {organizations.map((organization) => (
                <option value={organization.id} key={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {feedback && (
          <div
            className={`form-status form-status-${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        )}
        {loading ? (
          <div className="workspace-loading">
            <LoaderCircle className="spin" /> Loading access…
          </div>
        ) : !selected ? (
          <p>Create a workspace before inviting your team.</p>
        ) : (
          <div className="team-columns">
            <section className="team-list">
              <div className="section-title">
                <UsersRound />
                <div>
                  <h2>Current team</h2>
                  <p>
                    {members.length} people in {selected.name}
                  </p>
                </div>
              </div>
              {members.map((member) => (
                <article
                  className="person-row"
                  id={`member-${member.id}`}
                  tabIndex={-1}
                  key={member.id}
                >
                  <div className="avatar">
                    {member.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.email}</span>
                    <div className="role-chips">
                      <em>{member.organizationRole}</em>
                      {eventRoles
                        .filter((item) => item.userId === member.id)
                        .map((item) => (
                          <em key={`${item.eventId}-${item.role}`}>
                            {item.role} · {item.eventName}
                          </em>
                        ))}
                    </div>
                  </div>
                </article>
              ))}
            </section>
            <aside className="invite-panel" id="invite-member">
              <Mail />
              <h2>Invite someone</h2>
              <p>
                Reviewer and speaker access is scoped to one event. Workspace
                admins can manage every event.
              </p>
              <form onSubmit={invite}>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    required
                    autoFocus={
                      requestedRole === "reviewer" ||
                      requestedRole === "speaker"
                    }
                  />
                </label>
                <label>
                  Role
                  <select
                    value={role}
                    onChange={(event) =>
                      setRole(event.target.value as typeof role)
                    }
                  >
                    <option value="reviewer">Reviewer</option>
                    <option value="speaker">Speaker</option>
                    <option value="admin">Workspace admin</option>
                  </select>
                </label>
                {role !== "admin" && (
                  <label>
                    Event
                    <select
                      name="eventId"
                      required
                      defaultValue={requestedEventId}
                    >
                      <option value="">Choose an event</option>
                      {events.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button className="button button-large" disabled={submitting}>
                  {submitting ? "Creating…" : "Create and queue invitation"}
                  <ArrowRight size={18} />
                </button>
              </form>
              {invitations.length > 0 && (
                <div className="pending-list">
                  <h3>Pending</h3>
                  {invitations.map((item) => (
                    <div key={item.id}>
                      <span>{item.email}</span>
                      <small>
                        {item.role}
                        {item.eventName ? ` · ${item.eventName}` : ""}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
