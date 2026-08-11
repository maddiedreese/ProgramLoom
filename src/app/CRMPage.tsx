import {
  Activity,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronRight,
  CircleUserRound,
  Download,
  FileSpreadsheet,
  Filter,
  GitMerge,
  History,
  Inbox,
  KanbanSquare,
  ListFilter,
  LoaderCircle,
  Mail,
  MessageSquareText,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  Tags,
  Upload,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { captureProductEvent } from "../lib/telemetry";
import { SidebarUser } from "./SidebarUser";

type User = { id: string; email: string; name: string };
type Organization = {
  id: string;
  name: string;
  slug: string;
  role: string;
  eventCount: number;
};
type EventRecord = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
};
type Contact = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  pronouns?: string | null;
  company: string | null;
  jobTitle: string | null;
  bio: string | null;
  phone?: string | null;
  region?: string | null;
  tags: string[];
  source: string;
  pipelineCardId?: string | null;
  pipelineStage?: string | null;
  customFields: Record<string, unknown>;
};
type CustomField = {
  id: string;
  name: string;
  fieldType: string;
  options: string[];
};
type Segment = {
  id: string;
  name: string;
  segmentType: "dynamic" | "curated";
  count: number;
  filter: DirectoryFilter;
};
type Card = {
  id: string;
  contactId: string;
  stage: string;
  score: number | null;
  rationale: string | null;
  firstName: string;
  lastName: string;
  email: string;
  company: string | null;
  jobTitle: string | null;
};
type Feedback = { kind: "success" | "error"; message: string };
type DirectoryFilter = {
  search?: string;
  companies: string[];
  jobTitles: string[];
  tags: string[];
};
type ImportRow = Record<string, string>;

const stageLabels: Record<string, string> = {
  researching: "Researching",
  identified: "Identified",
  approved: "Approved",
  contacted: "Contacted",
  interested: "Interested",
  confirmed: "Confirmed",
  future_fit: "Future Fit",
  declined: "Declined",
};
const stages = Object.keys(stageLabels);
const tabs = [
  ["dashboard", "Dashboard", BarChart3],
  ["directory", "Directory", UsersRound],
  ["pipeline", "Pipeline", KanbanSquare],
  ["segments", "Segments", ListFilter],
  ["interest", "Interest forms", Inbox],
  ["history", "Email history", History],
  ["fields", "Fields", Settings2],
] as const;

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const result = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed.");
  return result;
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function slugHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function canSaveCrmSegment(
  filter: DirectoryFilter,
  selectedCount: number,
) {
  return Boolean(
    filter.search ||
    filter.companies.length ||
    filter.jobTitles.length ||
    filter.tags.length ||
    selectedCount > 0,
  );
}

export function reconcileCrmSelection(
  selectedIds: string[],
  contacts: Array<{ id: string }>,
) {
  const visibleContactIds = new Set(contacts.map((contact) => contact.id));
  return selectedIds.filter((contactId) => visibleContactIds.has(contactId));
}

export function resolveHandoffContacts<T extends { id: string }>(
  contacts: T[],
  selectedIds: string[],
) {
  if (!selectedIds.length) return contacts;
  const selected = new Set(selectedIds);
  return contacts.filter((contact) => selected.has(contact.id));
}

export function defaultCrmSegmentType(selectedCount: number) {
  return selectedCount > 0 ? "curated" : "dynamic";
}

export function duplicateContactIds(duplicates: Array<{ id: string }>) {
  return [...new Set(duplicates.map((duplicate) => duplicate.id))];
}

export function defaultOutreachEventId(events: Array<{ id: string }>) {
  return events[0]?.id ?? "";
}

export function resolveCrmOrganization(
  organizations: Array<{ id: string }>,
  queryOrganization: string | null,
  eventOrganization: string | null,
) {
  return organizations.some((item) => item.id === eventOrganization)
    ? eventOrganization!
    : organizations.some((item) => item.id === queryOrganization)
      ? queryOrganization!
      : (organizations[0]?.id ?? "");
}

export function CRMPage({ user }: { user: User }) {
  const initialQuery = new URLSearchParams(window.location.search);
  const addSpeakerEventId = initialQuery.get("eventId") ?? "";
  const requestedContactId = initialQuery.get("contact") ?? "";
  const createsSpeaker =
    initialQuery.get("action") === "add-speaker" && Boolean(addSpeakerEventId);
  const opensSpeakerHandoff =
    initialQuery.get("action") === "handoff-speaker" &&
    Boolean(addSpeakerEventId);
  const importsSpeakers =
    initialQuery.get("action") === "import-speakers" &&
    Boolean(addSpeakerEventId);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number][0]>(
    createsSpeaker || opensSpeakerHandoff || importsSpeakers
      ? "directory"
      : "dashboard",
  );
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [pipeline, setPipeline] = useState<Card[]>([]);
  const [overview, setOverview] = useState<Record<string, unknown>>();
  const [history, setHistory] = useState<{
    campaigns: Record<string, unknown>[];
    recipients: Record<string, unknown>[];
  }>({ campaigns: [], recipients: [] });
  const [interestForms, setInterestForms] = useState<Record<string, unknown>[]>(
    [],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<DirectoryFilter>({
    companies: [],
    jobTitles: [],
    tags: [],
  });
  const [facets, setFacets] = useState<{
    companies: string[];
    jobTitles: string[];
    tags: string[];
  }>({ companies: [], jobTitles: [], tags: [] });
  const [detail, setDetail] = useState<Record<string, unknown>>();
  const [pipelineDetail, setPipelineDetail] =
    useState<Record<string, unknown>>();
  const [modal, setModal] = useState<string | undefined>(
    importsSpeakers
      ? "import"
      : createsSpeaker
        ? "add-contact"
        : opensSpeakerHandoff
          ? "handoff"
          : undefined,
  );
  const [feedback, setFeedback] = useState<Feedback>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const selectedOrganization = organizations.find(
    (item) => item.id === organizationId,
  );

  useEffect(() => {
    Promise.all([
      api<{ organizations: Organization[] }>("/api/organizations"),
      addSpeakerEventId
        ? api<{ event: { organizationId: string } }>(
            `/api/events/${addSpeakerEventId}`,
          )
        : Promise.resolve(undefined),
    ])
      .then(([{ organizations: items }, targetEvent]) => {
        setOrganizations(items);
        const queryOrganization = new URLSearchParams(
          window.location.search,
        ).get("organization");
        setOrganizationId(
          resolveCrmOrganization(
            items,
            queryOrganization,
            targetEvent?.event.organizationId ?? null,
          ),
        );
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, []);

  async function loadDirectory(nextFilter = filter) {
    if (!organizationId) return;
    const query = new URLSearchParams();
    if (nextFilter.search) query.set("search", nextFilter.search);
    nextFilter.companies.forEach((value) => query.append("company", value));
    nextFilter.jobTitles.forEach((value) => query.append("jobTitle", value));
    nextFilter.tags.forEach((value) => query.append("tag", value));
    const result = await api<{ contacts: Contact[]; facets: typeof facets }>(
      `/api/crm/organizations/${organizationId}/contacts?${query}`,
    );
    setContacts(result.contacts);
    setFacets(result.facets);
    if (
      !nextFilter.search &&
      !nextFilter.companies.length &&
      !nextFilter.jobTitles.length &&
      !nextFilter.tags.length
    )
      setAllContacts(result.contacts);
  }

  async function loadAll() {
    if (!organizationId) return;
    const [
      directoryResult,
      eventResult,
      fieldResult,
      segmentResult,
      pipelineResult,
      overviewResult,
      historyResult,
      formsResult,
    ] = await Promise.all([
      api<{ contacts: Contact[]; facets: typeof facets }>(
        `/api/crm/organizations/${organizationId}/contacts`,
      ),
      api<{ events: EventRecord[] }>(
        `/api/organizations/${organizationId}/events`,
      ),
      api<{ fields: CustomField[] }>(
        `/api/crm/organizations/${organizationId}/fields`,
      ),
      api<{ segments: Segment[] }>(
        `/api/crm/organizations/${organizationId}/segments`,
      ),
      api<{ cards: Card[] }>(
        `/api/crm/organizations/${organizationId}/pipeline`,
      ),
      api<Record<string, unknown>>(
        `/api/crm/organizations/${organizationId}/overview`,
      ),
      api<{
        campaigns: Record<string, unknown>[];
        recipients: Record<string, unknown>[];
      }>(`/api/crm/organizations/${organizationId}/history`),
      api<{ forms: Record<string, unknown>[] }>(
        `/api/crm/organizations/${organizationId}/interest-forms`,
      ),
    ]);
    setContacts(directoryResult.contacts);
    setAllContacts(directoryResult.contacts);
    setFacets(directoryResult.facets);
    setEvents(eventResult.events);
    setFields(fieldResult.fields);
    setSegments(segmentResult.segments);
    setPipeline(pipelineResult.cards);
    setOverview(overviewResult);
    setHistory(historyResult);
    setInterestForms(formsResult.forms);
    setSelected((current) =>
      reconcileCrmSelection(current, directoryResult.contacts),
    );
  }

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    loadAll()
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, [organizationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (organizationId) loadDirectory().catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [filter, organizationId]);

  async function openContact(contactId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("contact", contactId);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    const result = await api<Record<string, unknown>>(
      `/api/crm/organizations/${organizationId}/contacts/${contactId}`,
    );
    setDetail(result);
    setModal("contact");
  }
  function closeContact() {
    const url = new URL(window.location.href);
    url.searchParams.delete("contact");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    setModal(undefined);
    setDetail(undefined);
  }
  function closeModal() {
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    setModal(undefined);
  }

  useEffect(() => {
    if (
      !organizationId ||
      !requestedContactId ||
      opensSpeakerHandoff ||
      createsSpeaker
    )
      return;
    setActiveTab("directory");
    openContact(requestedContactId).catch((error: Error) =>
      setFeedback({ kind: "error", message: error.message }),
    );
  }, [organizationId, requestedContactId]);

  async function openCard(cardId: string) {
    setPipelineDetail(
      await api(`/api/crm/organizations/${organizationId}/pipeline/${cardId}`),
    );
    setModal("card");
  }

  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      await loadAll();
      setFeedback({ kind: "success", message });
      return true;
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Request failed.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading && !organizations.length)
    return (
      <main className="loading-page">
        <LoaderCircle className="spin" /> Loading the speaker network…
      </main>
    );
  return (
    <div className="crm-shell">
      <aside className="crm-sidebar">
        <a className="wordmark" href="/">
          <span className="mark">PL</span>ProgramLoom
        </a>
        <a className="back-link" href="/app">
          <ArrowLeft size={15} /> Events
        </a>
        <label className="crm-org-switcher">
          Workspace
          <select
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
        <p className="crm-nav-label">Speaker CRM</p>
        <nav className="crm-nav">
          {tabs.map(([id, label, Icon]) => (
            <button
              className={activeTab === id ? "active" : ""}
              key={id}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <SidebarUser user={user} />
      </aside>
      <main className="crm-main">
        <header className="crm-heading">
          <div>
            <p className="kicker">Cross-event intelligence</p>
            <h1>{tabs.find(([id]) => id === activeTab)?.[1]}</h1>
            <p>
              {selectedOrganization?.name} · persistent speaker relationships
              across every program.
            </p>
          </div>
          {activeTab === "directory" && (
            <div className="crm-heading-actions">
              <a
                className="button button-ghost"
                href={`/api/crm/organizations/${organizationId}/contacts/export.csv`}
              >
                <Download size={15} /> Export
              </a>
              <button
                className="button button-ghost"
                onClick={() => setModal("import")}
              >
                <Upload size={15} /> Import
              </button>
              <button
                className="button"
                onClick={() => setModal("add-contact")}
              >
                <UserPlus size={15} /> Add contact
              </button>
            </div>
          )}
        </header>
        {feedback && (
          <div className={`form-status form-status-${feedback.kind}`}>
            {feedback.message}
          </div>
        )}
        {loading ? (
          <div className="crm-inline-loading">
            <LoaderCircle className="spin" /> Refreshing live records…
          </div>
        ) : null}
        {activeTab === "dashboard" && (
          <DashboardPanel
            overview={overview}
            onCompany={(company) => {
              setFilter({ companies: [company], jobTitles: [], tags: [] });
              setActiveTab("directory");
            }}
          />
        )}
        {activeTab === "directory" && (
          <DirectoryPanel
            contacts={contacts}
            facets={facets}
            filter={filter}
            setFilter={setFilter}
            selected={selected}
            setSelected={setSelected}
            fields={fields}
            openContact={openContact}
            onSaveSegment={() => setModal("segment")}
            onCommunicate={() => setModal("outreach")}
            onHandoff={() => setModal("handoff")}
          />
        )}
        {activeTab === "pipeline" && (
          <PipelinePanel
            cards={pipeline}
            contacts={allContacts}
            openCard={openCard}
            onEnroll={() => setModal("enroll")}
            onMove={async (cardId, stage) => {
              await mutate(
                () =>
                  api(
                    `/api/crm/organizations/${organizationId}/pipeline/${cardId}`,
                    { method: "PATCH", body: JSON.stringify({ stage }) },
                  ),
                `Moved to ${stageLabels[stage]}.`,
              );
            }}
          />
        )}
        {activeTab === "segments" && (
          <SegmentsPanel
            segments={segments}
            organizationId={organizationId}
            openContact={openContact}
          />
        )}
        {activeTab === "interest" && (
          <InterestPanel
            forms={interestForms}
            organization={selectedOrganization}
            onCreate={() => setModal("interest")}
          />
        )}
        {activeTab === "history" && <HistoryPanel history={history} />}
        {activeTab === "fields" && (
          <FieldsPanel fields={fields} onCreate={() => setModal("field")} />
        )}
      </main>
      {modal === "add-contact" && (
        <AddContactModal
          busy={busy}
          close={closeModal}
          save={async (payload) => {
            setBusy(true);
            setFeedback(undefined);
            try {
              const result = await api<{
                contact: Contact;
                duplicates: Contact[];
              }>(`/api/crm/organizations/${organizationId}/contacts`, {
                method: "POST",
                body: JSON.stringify(payload),
              });
              if (createsSpeaker) {
                await api(`/api/crm/organizations/${organizationId}/handoff`, {
                  method: "POST",
                  body: JSON.stringify({
                    contactId: result.contact.id,
                    eventId: addSpeakerEventId,
                  }),
                });
                window.location.assign(
                  `/app/events/${addSpeakerEventId}/speakers`,
                );
                return;
              }
              await loadAll();
              if (result.duplicates.length) {
                await openContact(result.contact.id);
                setFeedback({
                  kind: "success",
                  message:
                    "Contact added. A possible duplicate was found; compare and merge it from the open profile.",
                });
              } else {
                setModal(undefined);
                setFeedback({
                  kind: "success",
                  message: "Contact added to the cross-event directory.",
                });
              }
            } catch (error) {
              setFeedback({
                kind: "error",
                message:
                  error instanceof Error ? error.message : "Request failed.",
              });
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {modal === "import" && (
        <ImportModal
          organizationId={organizationId}
          eventId={importsSpeakers ? addSpeakerEventId : undefined}
          close={closeModal}
          complete={async () => {
            await loadAll();
            if (importsSpeakers) {
              window.location.assign(
                `/app/events/${addSpeakerEventId}/speakers`,
              );
              return;
            }
            setModal(undefined);
            setFeedback({
              kind: "success",
              message:
                "Import complete. Existing emails were safely deduplicated.",
            });
          }}
        />
      )}
      {modal === "segment" && (
        <SegmentModal
          filter={filter}
          selected={selected}
          busy={busy}
          close={closeModal}
          save={async (payload) => {
            if (
              await mutate(
                () =>
                  api(`/api/crm/organizations/${organizationId}/segments`, {
                    method: "POST",
                    body: JSON.stringify(payload),
                  }),
                "Reusable segment saved.",
              )
            ) {
              setModal(undefined);
              setActiveTab("segments");
            }
          }}
        />
      )}
      {modal === "enroll" && (
        <EnrollModal
          contacts={allContacts.filter((contact) => !contact.pipelineCardId)}
          busy={busy}
          close={closeModal}
          save={async (payload) => {
            if (
              await mutate(
                () =>
                  api(`/api/crm/organizations/${organizationId}/pipeline`, {
                    method: "POST",
                    body: JSON.stringify(payload),
                  }),
                "Contact enrolled in the sourcing pipeline.",
              )
            )
              setModal(undefined);
          }}
        />
      )}
      {modal === "outreach" && (
        <OutreachModal
          contacts={allContacts.filter((contact) =>
            selected.includes(contact.id),
          )}
          events={events}
          busy={busy}
          close={closeModal}
          send={async (payload) => {
            if (
              await mutate(
                () =>
                  api(`/api/crm/organizations/${organizationId}/outreach`, {
                    method: "POST",
                    body: JSON.stringify(payload),
                  }),
                "Outreach prepared for durable delivery and recorded in email history.",
              )
            ) {
              captureProductEvent("crm_outreach_sent", {
                organization_id: organizationId,
                recipient_count: selected.length,
              });
              setModal(undefined);
              setActiveTab("history");
            }
          }}
        />
      )}
      {modal === "handoff" && (
        <HandoffModal
          contacts={resolveHandoffContacts(allContacts, selected)}
          events={events}
          defaultEventId={addSpeakerEventId}
          busy={busy}
          close={closeModal}
          handoff={async (contactId, eventId) => {
            if (
              await mutate(
                () =>
                  api(`/api/crm/organizations/${organizationId}/handoff`, {
                    method: "POST",
                    body: JSON.stringify({ contactId, eventId }),
                  }),
                "Speaker profile added to the event with its CRM data intact.",
              )
            )
              setModal(undefined);
          }}
        />
      )}
      {modal === "field" && (
        <FieldModal
          busy={busy}
          close={closeModal}
          save={async (payload) => {
            if (
              await mutate(
                () =>
                  api(`/api/crm/organizations/${organizationId}/fields`, {
                    method: "POST",
                    body: JSON.stringify(payload),
                  }),
                "Custom field added to every contact profile.",
              )
            )
              setModal(undefined);
          }}
        />
      )}
      {modal === "interest" && (
        <InterestModal
          events={events}
          busy={busy}
          close={closeModal}
          save={async (payload) => {
            if (
              await mutate(
                () =>
                  api(
                    `/api/crm/organizations/${organizationId}/interest-forms`,
                    { method: "POST", body: JSON.stringify(payload) },
                  ),
                "Public interest form published.",
              )
            )
              setModal(undefined);
          }}
        />
      )}
      {modal === "contact" && detail && (
        <ContactModal
          data={detail}
          fields={fields}
          events={events}
          busy={busy}
          close={closeContact}
          save={async (contactId, payload) => {
            const ok = await mutate(
              () =>
                api(
                  `/api/crm/organizations/${organizationId}/contacts/${contactId}`,
                  { method: "PATCH", body: JSON.stringify(payload) },
                ),
              "Contact profile saved.",
            );
            if (ok) await openContact(contactId);
          }}
          addNote={async (contactId, body) => {
            const ok = await mutate(
              () =>
                api(
                  `/api/crm/organizations/${organizationId}/contacts/${contactId}/notes`,
                  { method: "POST", body: JSON.stringify({ body }) },
                ),
              "Internal note saved.",
            );
            if (ok) await openContact(contactId);
          }}
          merge={async (primaryId, duplicateIds) => {
            const ok = await mutate(
              () =>
                api(`/api/crm/organizations/${organizationId}/merge`, {
                  method: "POST",
                  body: JSON.stringify({
                    primaryId,
                    duplicateIds,
                    preferred: {},
                  }),
                }),
              `${duplicateIds.length} duplicate record${duplicateIds.length === 1 ? "" : "s"} merged permanently into the primary contact.`,
            );
            if (ok) await openContact(primaryId);
          }}
          handoff={async (contactId, eventId) => {
            const ok = await mutate(
              () =>
                api(`/api/crm/organizations/${organizationId}/handoff`, {
                  method: "POST",
                  body: JSON.stringify({ contactId, eventId }),
                }),
              "Contact added to the event.",
            );
            if (ok) await openContact(contactId);
          }}
        />
      )}
      {modal === "card" && pipelineDetail && (
        <CardModal
          data={pipelineDetail}
          busy={busy}
          close={() => {
            setModal(undefined);
            setPipelineDetail(undefined);
          }}
          addNote={async (cardId, body) => {
            const ok = await mutate(
              () =>
                api(
                  `/api/crm/organizations/${organizationId}/pipeline/${cardId}/notes`,
                  { method: "POST", body: JSON.stringify({ body }) },
                ),
              "Pipeline note saved.",
            );
            if (ok) await openCard(cardId);
          }}
        />
      )}
    </div>
  );
}

function DashboardPanel({
  overview,
  onCompany,
}: {
  overview?: Record<string, unknown>;
  onCompany: (company: string) => void;
}) {
  const totals = (overview?.totals ?? {}) as Record<string, number>;
  const companies = (overview?.topCompanies ?? []) as {
    label: string;
    count: number;
  }[];
  const sources = (overview?.sources ?? []) as {
    label: string;
    count: number;
  }[];
  const pipeline = (overview?.pipeline ?? []) as {
    stage: string;
    count: number;
  }[];
  return (
    <div className="crm-dashboard">
      <section className="crm-kpis">
        {[
          ["Contacts", totals.contacts ?? 0],
          ["Events", totals.events ?? 0],
          ["Event speakers", totals.activeSpeakers ?? 0],
          ["Returning speakers", totals.returningSpeakers ?? 0],
        ].map(([label, value]) => (
          <article key={String(label)}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <div className="crm-widget-grid">
        <section className="crm-widget">
          <header>
            <div>
              <p className="kicker">Engagement flow</p>
              <h2>Speaker sourcing</h2>
            </div>
            <Activity />
          </header>
          <div className="funnel-bars">
            {stages.map((stage) => {
              const count =
                pipeline.find((row) => row.stage === stage)?.count ?? 0;
              return (
                <div key={stage}>
                  <span>{stageLabels[stage]}</span>
                  <i style={{ width: `${Math.max(6, count * 14)}%` }} />
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>
        </section>
        <section className="crm-widget">
          <header>
            <div>
              <p className="kicker">Network</p>
              <h2>Top companies</h2>
            </div>
            <Sparkles />
          </header>
          <div className="analytics-list">
            {companies.map((item) => (
              <button key={item.label} onClick={() => onCompany(item.label)}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
                <ChevronRight size={14} />
              </button>
            ))}
            {!companies.length && <p>No company data yet.</p>}
          </div>
        </section>
        <section className="crm-widget">
          <header>
            <div>
              <p className="kicker">Acquisition</p>
              <h2>Speaker sources</h2>
            </div>
            <BarChart3 />
          </header>
          <div className="analytics-list">
            {sources.map((item) => (
              <div key={item.label}>
                <span>{String(item.label).replaceAll("_", " ")}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function DirectoryPanel({
  contacts,
  facets,
  filter,
  setFilter,
  selected,
  setSelected,
  fields,
  openContact,
  onSaveSegment,
  onCommunicate,
  onHandoff,
}: {
  contacts: Contact[];
  facets: { companies: string[]; jobTitles: string[]; tags: string[] };
  filter: DirectoryFilter;
  setFilter: (value: DirectoryFilter) => void;
  selected: string[];
  setSelected: (value: string[]) => void;
  fields: CustomField[];
  openContact: (id: string) => void;
  onSaveSegment: () => void;
  onCommunicate: () => void;
  onHandoff: () => void;
}) {
  const hasFilter = Boolean(
    filter.search ||
    filter.companies.length ||
    filter.jobTitles.length ||
    filter.tags.length,
  );
  const canSaveSegment = canSaveCrmSegment(filter, selected.length);
  return (
    <section className="directory-panel">
      <div className="directory-toolbar">
        <label className="crm-search">
          <Search size={16} />
          <input
            aria-label="Search contacts"
            value={filter.search ?? ""}
            onChange={(event) =>
              setFilter({ ...filter, search: event.target.value })
            }
            placeholder="Search name, email, company or title"
          />
        </label>
        <div
          id="crm-directory-filters"
          className="filter-popover filter-panel"
          aria-label="Directory filters"
        >
          <strong>
            <Filter size={15} /> Filters
          </strong>
          <div>
            <label>
              Company
              <select
                value={filter.companies[0] ?? ""}
                onChange={(event) =>
                  setFilter({
                    ...filter,
                    companies: event.target.value ? [event.target.value] : [],
                  })
                }
              >
                <option value="">Any company</option>
                {facets.companies.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Job title
              <select
                value={filter.jobTitles[0] ?? ""}
                onChange={(event) =>
                  setFilter({
                    ...filter,
                    jobTitles: event.target.value ? [event.target.value] : [],
                  })
                }
              >
                <option value="">Any title</option>
                {facets.jobTitles.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Tag
              <select
                value={filter.tags[0] ?? ""}
                onChange={(event) =>
                  setFilter({
                    ...filter,
                    tags: event.target.value ? [event.target.value] : [],
                  })
                }
              >
                <option value="">Any tag</option>
                {facets.tags.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                setFilter({ companies: [], jobTitles: [], tags: [] })
              }
            >
              Clear all
            </button>
          </div>
        </div>
        <button
          className="button button-ghost"
          onClick={onSaveSegment}
          disabled={!canSaveSegment}
          title={
            canSaveSegment
              ? "Save this audience"
              : "Choose a filter or select contacts first"
          }
        >
          <Save size={15} /> Save segment
        </button>
        <button
          className="button button-ghost"
          onClick={() =>
            setSelected(
              contacts.every((contact) => selected.includes(contact.id))
                ? []
                : contacts.map((contact) => contact.id),
            )
          }
          disabled={!contacts.length}
        >
          {contacts.every((contact) => selected.includes(contact.id))
            ? "Clear shown contacts"
            : `Select all ${contacts.length} shown contacts`}
        </button>
      </div>
      {hasFilter && (
        <div className="filter-chips">
          {[
            ...(filter.companies ?? []),
            ...(filter.jobTitles ?? []),
            ...(filter.tags ?? []),
          ].map((value) => (
            <span key={value}>{value}</span>
          ))}
          <button
            onClick={() =>
              setFilter({ companies: [], jobTitles: [], tags: [] })
            }
          >
            Clear filters
          </button>
        </div>
      )}
      {selected.length > 0 && (
        <div className="bulk-bar">
          <strong>{selected.length} selected</strong>
          <button onClick={onCommunicate}>
            <Mail size={15} /> Communicate
          </button>
          <button onClick={onHandoff}>
            <UserPlus size={15} /> Add to event
          </button>
          <button onClick={() => setSelected([])}>
            <X size={15} /> Clear
          </button>
        </div>
      )}
      <div className="directory-table-wrap">
        <table className="directory-table">
          <thead>
            <tr>
              <th>
                <input
                  aria-label="Select all contacts"
                  type="checkbox"
                  checked={
                    contacts.length > 0 &&
                    contacts.every((contact) => selected.includes(contact.id))
                  }
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? contacts.map((contact) => contact.id)
                        : [],
                    )
                  }
                />
              </th>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Job title</th>
              <th>Tags</th>
              <th>Pipeline</th>
              {fields.slice(0, 2).map((field) => (
                <th key={field.id}>{field.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
              <tr key={contact.id}>
                <td>
                  <input
                    aria-label={`Select ${contact.firstName} ${contact.lastName}`}
                    type="checkbox"
                    checked={selected.includes(contact.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...selected, contact.id]
                          : selected.filter((id) => id !== contact.id),
                      )
                    }
                  />
                </td>
                <td>
                  <button
                    className="contact-link"
                    onClick={() => openContact(contact.id)}
                  >
                    <span className="contact-avatar">
                      {contact.firstName[0]}
                      {contact.lastName[0]}
                    </span>
                    <span className="contact-link-copy">
                      <strong>
                        {contact.firstName} {contact.lastName}
                      </strong>
                      <small>Open contact profile</small>
                    </span>
                  </button>
                </td>
                <td>{contact.email}</td>
                <td>{contact.company || "—"}</td>
                <td>{contact.jobTitle || "—"}</td>
                <td>
                  <div className="tag-row">
                    {contact.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </td>
                <td>
                  {contact.pipelineStage ? (
                    <em
                      className={`stage-badge stage-${contact.pipelineStage}`}
                    >
                      {stageLabels[contact.pipelineStage]}
                    </em>
                  ) : (
                    "—"
                  )}
                </td>
                {fields.slice(0, 2).map((field) => (
                  <td key={field.id}>
                    {String(contact.customFields[field.id] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!contacts.length && (
          <div className="crm-empty">
            <CircleUserRound />
            <h2>No matching contacts</h2>
            <p>Import a file, create a contact, or clear the active filters.</p>
          </div>
        )}
      </div>
      <footer className="table-footer">
        <strong>{contacts.length}</strong> contacts shown
      </footer>
    </section>
  );
}

function PipelinePanel({
  cards,
  contacts,
  openCard,
  onEnroll,
  onMove,
}: {
  cards: Card[];
  contacts: Contact[];
  openCard: (id: string) => void;
  onEnroll: () => void;
  onMove: (cardId: string, stage: string) => void;
}) {
  const [dragging, setDragging] = useState<string>();
  function drop(event: DragEvent, stage: string) {
    event.preventDefault();
    if (dragging) onMove(dragging, stage);
    setDragging(undefined);
  }
  return (
    <section>
      <div className="pipeline-toolbar">
        <p>
          {cards.length} active and archived prospects across eight durable
          stages.
        </p>
        <button
          className="button"
          disabled={!contacts.length}
          onClick={onEnroll}
        >
          <Plus size={15} /> Enroll prospect
        </button>
      </div>
      <div className="kanban-board">
        {stages.map((stage) => (
          <section
            className={`kanban-column stage-${stage}`}
            key={stage}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, stage)}
          >
            <header>
              <strong>{stageLabels[stage]}</strong>
              <span>{cards.filter((card) => card.stage === stage).length}</span>
            </header>
            <div>
              {cards
                .filter((card) => card.stage === stage)
                .map((card) => (
                  <article
                    draggable
                    key={card.id}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => setDragging(undefined)}
                  >
                    <button onClick={() => openCard(card.id)}>
                      <small>{card.company || "Independent"}</small>
                      <h3>
                        {card.firstName} {card.lastName}
                      </h3>
                      <p>{card.jobTitle || card.email}</p>
                      {card.score !== null && (
                        <strong className="prospect-score">{card.score}</strong>
                      )}
                    </button>
                    <label>
                      Move to
                      <select
                        aria-label={`Move ${card.firstName} ${card.lastName}`}
                        value={card.stage}
                        onChange={(event) =>
                          onMove(card.id, event.target.value)
                        }
                      >
                        {stages.map((item) => (
                          <option key={item} value={item}>
                            {stageLabels[item]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function SegmentsPanel({
  segments,
  organizationId,
  openContact,
}: {
  segments: Segment[];
  organizationId: string;
  openContact: (id: string) => void;
}) {
  const [open, setOpen] = useState<{ segment: Segment; contacts: Contact[] }>();
  async function load(segment: Segment) {
    const result = await api<{ contacts: Contact[] }>(
      `/api/crm/organizations/${organizationId}/segments/${segment.id}`,
    );
    setOpen({ segment, contacts: result.contacts });
  }
  return (
    <section className="segments-grid">
      {segments.map((segment) => (
        <button key={segment.id} onClick={() => load(segment)}>
          <ListFilter />
          <span>
            <em>{segment.segmentType}</em>
            <h2>{segment.name}</h2>
            <p>
              {segment.count} contacts ·{" "}
              {segment.segmentType === "dynamic"
                ? "updates automatically"
                : "curated by your team"}
            </p>
          </span>
          <ChevronRight />
        </button>
      ))}
      {!segments.length && (
        <div className="crm-empty">
          <ListFilter />
          <h2>No saved segments</h2>
          <p>Apply directory filters and choose Save segment.</p>
          <a className="button button-small" href="#crm-directory-filters">
            Open directory filters
          </a>
        </div>
      )}
      {open && (
        <div className="segment-members">
          <header>
            <div>
              <small>{open.segment.segmentType}</small>
              <h2>{open.segment.name}</h2>
            </div>
            <button onClick={() => setOpen(undefined)}>
              <X /> Close segment
            </button>
          </header>
          {open.contacts.map((contact) => (
            <button key={contact.id} onClick={() => openContact(contact.id)}>
              <span>
                {contact.firstName} {contact.lastName}
              </span>
              <small>{contact.email}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function InterestPanel({
  forms,
  organization,
  onCreate,
}: {
  forms: Record<string, unknown>[];
  organization?: Organization;
  onCreate: () => void;
}) {
  return (
    <section>
      <div className="pipeline-toolbar">
        <p>Year-round speaker interest, independent of CFP deadlines.</p>
        <button className="button" onClick={onCreate}>
          <Plus size={15} /> Create interest form
        </button>
      </div>
      <div className="interest-form-list">
        {forms.map((form) => (
          <article key={String(form.id)}>
            <div>
              <em>{String(form.mode).replaceAll("_", " ")}</em>
              <h2>{String(form.title)}</h2>
              <p>{String(form.description ?? "No description")}</p>
            </div>
            <dl>
              <div>
                <dt>Submissions</dt>
                <dd>{String(form.submissionCount)}</dd>
              </div>
              <div>
                <dt>Unique speakers</dt>
                <dd>{String(form.speakerCount)}</dd>
              </div>
            </dl>
            <div>
              <a
                href={`/interest/${organization?.slug ?? ""}/${String(form.slug)}`}
                target="_blank"
                rel="noreferrer"
              >
                View form
              </a>
              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    `${location.origin}/interest/${organization?.slug ?? ""}/${String(form.slug)}`,
                  )
                }
              >
                Copy link
              </button>
            </div>
          </article>
        ))}
        {!forms.length && (
          <div className="crm-empty">
            <Inbox />
            <h2>No interest forms yet</h2>
            <p>
              Publish a year-round intake that creates contacts and Identified
              pipeline cards automatically.
            </p>
            <button className="button button-small" onClick={onCreate}>
              <Plus size={15} /> Create interest form
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function HistoryPanel({
  history,
}: {
  history: {
    campaigns: Record<string, unknown>[];
    recipients: Record<string, unknown>[];
  };
}) {
  const [tab, setTab] = useState<"campaigns" | "emails">("campaigns");
  return (
    <section className="history-panel">
      <div className="tab-row">
        <button
          className={tab === "campaigns" ? "active" : ""}
          onClick={() => setTab("campaigns")}
        >
          Campaigns
        </button>
        <button
          className={tab === "emails" ? "active" : ""}
          onClick={() => setTab("emails")}
        >
          Email deliveries
        </button>
      </div>
      <table>
        <thead>
          <tr>
            {(tab === "campaigns"
              ? [
                  "Subject",
                  "Recipients",
                  "Unique opens",
                  "Status",
                  "Created by",
                  "Created at",
                ]
              : [
                  "Recipient",
                  "Email",
                  "Subject",
                  "Status",
                  "Prepared by",
                  "Prepared at",
                ]
            ).map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(tab === "campaigns" ? history.campaigns : history.recipients).map(
            (row) =>
              tab === "campaigns" ? (
                <tr key={String(row.id)}>
                  <td>{String(row.subject)}</td>
                  <td>{String(row.recipientCount)}</td>
                  <td>{String(row.uniqueOpens ?? 0)}</td>
                  <td>
                    <em>{String(row.status)}</em>
                  </td>
                  <td>{String(row.sentBy)}</td>
                  <td>{formatDate(row.createdAt)}</td>
                </tr>
              ) : (
                <tr key={String(row.id)}>
                  <td>{String(row.recipientName)}</td>
                  <td>{String(row.recipientEmail)}</td>
                  <td>{String(row.subject)}</td>
                  <td>
                    <em>{String(row.status)}</em>
                  </td>
                  <td>{String(row.sentBy)}</td>
                  <td>{formatDate(row.sentAt)}</td>
                </tr>
              ),
          )}
        </tbody>
      </table>
      {!(tab === "campaigns" ? history.campaigns : history.recipients)
        .length && (
        <div className="crm-empty">
          <Mail />
          <h2>No outreach history</h2>
          <p>
            Messages prepared from the directory will appear here with their
            exact delivery state.
          </p>
        </div>
      )}
    </section>
  );
}

function FieldsPanel({
  fields,
  onCreate,
}: {
  fields: CustomField[];
  onCreate: () => void;
}) {
  return (
    <section>
      <div className="pipeline-toolbar">
        <p>
          Global metadata appears on contact profiles and as directory columns.
        </p>
        <button className="button" onClick={onCreate}>
          <Plus size={15} /> Add field
        </button>
      </div>
      <div className="field-library">
        <article>
          <small>Profile fields</small>
          <h2>System identity</h2>
          <p>
            Name, pronouns, email, title, company, phone, region, bio, tags and
            social links.
          </p>
        </article>
        {fields.map((field) => (
          <article key={field.id}>
            <small>Custom · global</small>
            <h2>{field.name}</h2>
            <p>
              {field.fieldType}
              {field.options.length ? ` · ${field.options.join(", ")}` : ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Modal({
  title,
  subtitle,
  close,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);
  return (
    <div
      className="crm-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className={`crm-modal ${wide ? "crm-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <p className="kicker">{subtitle}</p>
            <h2>{title}</h2>
          </div>
          <button
            className="button button-small button-ghost"
            data-dismiss
            onClick={close}
          >
            <X size={16} /> Close details
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function AddContactModal({
  busy,
  close,
  save,
}: {
  busy: boolean;
  close: () => void;
  save: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Modal title="Add a contact" subtitle="Cross-event directory" close={close}>
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const fullName = String(data.get("name")).trim().split(/\s+/);
          save({
            firstName: fullName.shift(),
            lastName: fullName.join(" ") || "—",
            email: data.get("email"),
            jobTitle: data.get("jobTitle") || null,
            company: data.get("company") || null,
            bio: data.get("bio") || null,
            tags: String(data.get("tags") || "")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
            social: {},
            source: "manual",
          });
        }}
      >
        <label>
          Full name
          <input name="name" required />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <div className="form-columns">
          <label>
            Job title
            <input name="jobTitle" />
          </label>
          <label>
            Company
            <input name="company" />
          </label>
        </div>
        <label>
          Bio
          <textarea name="bio" rows={5} />
        </label>
        <label>
          Tags <small>Comma separated</small>
          <input name="tags" placeholder="AI, Keynote, Platform" />
        </label>
        <button className="button" disabled={busy}>
          <UserPlus size={15} /> Add to directory
        </button>
      </form>
    </Modal>
  );
}

function ImportModal({
  organizationId,
  eventId,
  close,
  complete,
}: {
  organizationId: string;
  eventId?: string;
  close: () => void;
  complete: () => void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fields = [
    ["firstName", "First name", true],
    ["lastName", "Last name", true],
    ["email", "Email", true],
    ["jobTitle", "Job title", false],
    ["company", "Company", false],
    ["bio", "Bio", false],
    ["tags", "Tags", false],
    ["region", "Region", false],
  ] as const;
  async function fileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setIssues(["Files must be 8 MB or smaller."]);
      return;
    }
    let matrix: (string | number | boolean | Date | null)[][];
    if (/\.xlsx$/i.test(file.name)) {
      const readXlsxFile = (await import("read-excel-file/browser")).default;
      matrix = (await readXlsxFile(file)) as unknown as (
        string | number | boolean | Date | null
      )[][];
    } else matrix = splitCsv(await file.text());
    if (matrix.length < 2) {
      setIssues(["The file needs a header row and at least one contact."]);
      return;
    }
    if (matrix.length > 1001) {
      setIssues(["Imports support up to 1,000 contacts per file."]);
      return;
    }
    const detected = matrix[0].map((value) => String(value ?? "").trim());
    const nextRows = matrix
      .slice(1)
      .map((values) =>
        Object.fromEntries(
          detected.map((header, index) => [
            header,
            String(values[index] ?? "").trim(),
          ]),
        ),
      );
    const aliases: Record<string, string[]> = {
      firstName: ["firstname", "first", "name", "fullname"],
      lastName: ["lastname", "last", "surname"],
      email: ["email", "emailaddress"],
      jobTitle: ["title", "jobtitle", "role"],
      company: ["company", "organization", "organisation"],
      bio: ["bio", "biography"],
      tags: ["tags", "tag"],
      region: ["region", "location"],
    };
    setHeaders(detected);
    setRows(nextRows);
    setMapping(
      Object.fromEntries(
        Object.entries(aliases).map(([field, names]) => [
          field,
          detected.find((header) => names.includes(slugHeader(header))) ?? "",
        ]),
      ),
    );
    setIssues([]);
  }
  const preview = rows.map((row, index) => {
    const mapped = Object.fromEntries(
      fields.map(([key]) => [key, row[mapping[key]] ?? ""]),
    ) as Record<(typeof fields)[number][0], string>;
    const firstNameHeader = slugHeader(mapping.firstName ?? "");
    if (
      !mapped.lastName &&
      ["name", "fullname"].includes(firstNameHeader) &&
      mapped.firstName.trim()
    ) {
      const parts = mapped.firstName.trim().split(/\s+/);
      mapped.firstName = parts.shift() ?? "";
      mapped.lastName = parts.join(" ");
    }
    const rowIssues: string[] = [];
    if (!mapped.firstName) rowIssues.push("First name missing");
    if (!mapped.lastName) rowIssues.push("Last name missing");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mapped.email))
      rowIssues.push("Valid email required");
    return { index: index + 2, mapped, issues: rowIssues };
  });
  async function commit() {
    const invalid = preview.filter((row) => row.issues.length);
    if (invalid.length) {
      setIssues(
        invalid.map((row) => `Row ${row.index}: ${row.issues.join(", ")}`),
      );
      return;
    }
    setBusy(true);
    try {
      await api(`/api/crm/organizations/${organizationId}/import`, {
        method: "POST",
        body: JSON.stringify({
          mode: "create_and_update",
          eventId,
          rows: preview.map(({ mapped }) => ({
            ...mapped,
            tags: mapped.tags
              .split(/[|,]/)
              .map((tag) => tag.trim())
              .filter(Boolean),
            social: {},
            source: "import",
          })),
        }),
      });
      complete();
    } catch (error) {
      setIssues([error instanceof Error ? error.message : "Import failed."]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={eventId ? "Import speakers" : "Import contacts"}
      subtitle={
        eventId
          ? "CSV or XLSX · deduplicated by email · added to this event"
          : "CSV or XLSX · up to 1,000 rows"
      }
      close={close}
      wide
    >
      <div className="import-drop">
        <FileSpreadsheet />
        <label>
          Choose contact file
          <input
            aria-label="Choose contact file"
            type="file"
            accept=".csv,.xlsx,text/csv"
            onChange={fileSelected}
          />
        </label>
        <a
          download="programloom-speaker-import.csv"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent("First Name,Last Name,Email,Job Title,Company,Bio,Tags,Region\n")}`}
        >
          Download template
        </a>
      </div>
      {headers.length > 0 && (
        <>
          <section className="mapping-grid">
            <h3>Map columns</h3>
            {fields.map(([key, label, required]) => (
              <label key={key}>
                {label}
                {required ? " *" : ""}
                <select
                  value={mapping[key] ?? ""}
                  onChange={(event) =>
                    setMapping({ ...mapping, [key]: event.target.value })
                  }
                >
                  <option value="">Not mapped</option>
                  {headers.map((header) => (
                    <option key={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
          </section>
          <div className="import-preview">
            <h3>Validation preview · {rows.length} rows</h3>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 12).map((row) => (
                  <tr key={row.index}>
                    <td>{row.index}</td>
                    <td>
                      {row.mapped.firstName} {row.mapped.lastName}
                    </td>
                    <td>{row.mapped.email}</td>
                    <td>{row.mapped.company}</td>
                    <td
                      className={
                        row.issues.length ? "import-error" : "import-valid"
                      }
                    >
                      {row.issues.join(", ") || "Ready"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issues.length > 0 && (
            <div className="form-status form-status-error">
              {issues.slice(0, 8).map((issue) => (
                <div key={issue}>{issue}</div>
              ))}
            </div>
          )}
          <button className="button" onClick={commit} disabled={busy}>
            <Upload size={15} />{" "}
            {busy
              ? "Importing…"
              : `Import ${rows.length} ${eventId ? "speakers" : "contacts"}`}
          </button>
        </>
      )}
    </Modal>
  );
}

function SegmentModal({
  filter,
  selected,
  busy,
  close,
  save,
}: {
  filter: DirectoryFilter;
  selected: string[];
  busy: boolean;
  close: () => void;
  save: (payload: Record<string, unknown>) => void;
}) {
  const defaultType = defaultCrmSegmentType(selected.length);
  return (
    <Modal title="Save this audience" subtitle="Reusable segment" close={close}>
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          save({
            name: data.get("name"),
            segmentType: data.get("segmentType"),
            filter,
            contactIds: selected,
          });
        }}
      >
        <label>
          Segment name
          <input name="name" defaultValue="AI Experts" required />
        </label>
        <fieldset>
          <legend>Membership</legend>
          <label className="choice-card">
            <input
              type="radio"
              name="segmentType"
              value="dynamic"
              defaultChecked={defaultType === "dynamic"}
            />
            <span>
              <strong>Dynamic segment</strong>
              <small>
                New contacts join automatically when they match these filters.
              </small>
            </span>
          </label>
          <label className="choice-card">
            <input
              type="radio"
              name="segmentType"
              value="curated"
              defaultChecked={defaultType === "curated"}
            />
            <span>
              <strong>Curated list</strong>
              <small>
                Keep exactly the {selected.length || "selected"} contacts chosen
                by your team.
              </small>
            </span>
          </label>
        </fieldset>
        <p className="form-help" role="status">
          {selected.length
            ? `${selected.length} selected contact${selected.length === 1 ? "" : "s"} will be saved as the exact curated membership by default.`
            : "The current filters will define dynamic membership and include future matching contacts."}
        </p>
        <button className="button" disabled={busy}>
          <Save size={15} /> Save segment
        </button>
      </form>
    </Modal>
  );
}

function EnrollModal({
  contacts,
  busy,
  close,
  save,
}: {
  contacts: Contact[];
  busy: boolean;
  close: () => void;
  save: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      title="Enroll a prospect"
      subtitle="Speaker sourcing pipeline"
      close={close}
    >
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          save({
            contactId: data.get("contactId"),
            stage: data.get("stage"),
            score: data.get("score") ? Number(data.get("score")) : null,
            rationale: data.get("rationale") || null,
          });
        }}
      >
        <label>
          Contact
          <select
            name="contactId"
            required
            defaultValue={contacts[0]?.id ?? ""}
          >
            <option value="" disabled>
              Choose a directory contact
            </option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName} {contact.lastName} · {contact.company}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starting stage
          <select name="stage" defaultValue="identified">
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {stageLabels[stage]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Score · 0–100
          <input
            name="score"
            type="number"
            min="0"
            max="100"
            defaultValue="85"
          />
        </label>
        <label>
          Rationale
          <textarea
            name="rationale"
            rows={5}
            defaultValue="Strong platform-engineering track record; ideal for Platform & Infra track."
          />
        </label>
        <button className="button" disabled={busy}>
          <Plus size={15} /> Enroll prospect
        </button>
      </form>
    </Modal>
  );
}

function OutreachModal({
  contacts,
  events,
  busy,
  close,
  send,
}: {
  contacts: Contact[];
  events: EventRecord[];
  busy: boolean;
  close: () => void;
  send: (payload: Record<string, unknown>) => void;
}) {
  const [subject, setSubject] = useState("Speak at DevFlow Conf 2027?");
  const [body, setBody] = useState(
    "We would love to invite you to share your experience with the DevFlow community. Would you be interested in speaking?",
  );
  const first = contacts[0];
  const preview = (value: string) =>
    value
      .replaceAll("{{first_name}}", first?.firstName ?? "Priya")
      .replaceAll("{{last_name}}", first?.lastName ?? "Raman")
      .replaceAll(
        "{{full_name}}",
        first ? `${first.firstName} ${first.lastName}` : "Priya Raman",
      )
      .replaceAll("{{company}}", first?.company ?? "Latticework Systems");
  return (
    <Modal
      title="Compose outreach"
      subtitle={`${contacts.length} selected contacts`}
      close={close}
      wide
    >
      <div className="outreach-layout">
        <form
          className="crm-form"
          onSubmit={(event) => {
            event.preventDefault();
            send({
              contactIds: contacts.map((contact) => contact.id),
              eventId: new FormData(event.currentTarget).get("eventId"),
              subject,
              body,
              replyTo: new FormData(event.currentTarget).get("replyTo") || null,
            });
          }}
        >
          <div className="recipient-pills">
            {contacts.map((contact) => (
              <span key={contact.id}>
                {contact.firstName} {contact.lastName}
              </span>
            ))}
          </div>
          <label>
            Associated event
            <select
              name="eventId"
              required
              defaultValue={defaultOutreachEventId(events)}
            >
              <option value="" disabled>
                Choose an event
              </option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Replies sent to
            <input name="replyTo" type="email" placeholder="team@example.com" />
          </label>
          <label>
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
            />
          </label>
          <label>
            Message
            <textarea
              rows={9}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
            />
          </label>
          <div className="merge-tags">
            <span>Merge tags:</span>
            {[
              "{{first_name}}",
              "{{last_name}}",
              "{{full_name}}",
              "{{company}}",
            ].map((tag) => (
              <button
                type="button"
                key={tag}
                onClick={() => setBody(`${body} ${tag}`)}
              >
                {tag}
              </button>
            ))}
          </div>
          <button className="button" disabled={busy || !contacts.length}>
            <Send size={15} /> Send now
          </button>
        </form>
        <section className="email-preview">
          <small>Personalization preview · {first?.email}</small>
          <h3>{preview(subject)}</h3>
          <p>Hi {first?.firstName ?? "Priya"},</p>
          {preview(body)
            .split("\n")
            .map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          <footer>ProgramLoom</footer>
        </section>
      </div>
    </Modal>
  );
}

function HandoffModal({
  contacts,
  events,
  defaultEventId,
  busy,
  close,
  handoff,
}: {
  contacts: Contact[];
  events: EventRecord[];
  defaultEventId?: string;
  busy: boolean;
  close: () => void;
  handoff: (contactId: string, eventId: string) => void;
}) {
  const [targetEventId, setTargetEventId] = useState(defaultEventId ?? "");
  return (
    <Modal
      title="Add speaker to event"
      subtitle="Profile-preserving handoff"
      close={close}
    >
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          handoff(String(data.get("contactId")), String(data.get("eventId")));
        }}
      >
        <label>
          Contact
          <select name="contactId" required>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName} {contact.lastName} · {contact.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target event
          <select
            name="eventId"
            required
            value={targetEventId}
            onChange={(event) => setTargetEventId(event.target.value)}
          >
            <option value="">Choose event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
        <p className="modal-explainer">
          Name, email, title, company, bio and social links carry into the event
          speaker roster without re-entry.
        </p>
        <button className="button" disabled={busy}>
          <UserPlus size={15} /> Add to event
        </button>
      </form>
    </Modal>
  );
}

function FieldModal({
  busy,
  close,
  save,
}: {
  busy: boolean;
  close: () => void;
  save: (payload: Record<string, unknown>) => void;
}) {
  const [type, setType] = useState("select");
  return (
    <Modal
      title="Create custom field"
      subtitle="Global contact metadata"
      close={close}
    >
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          save({
            name: data.get("name"),
            fieldType: type,
            options: ["select", "multiselect"].includes(type)
              ? String(data.get("options"))
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean)
              : [],
          });
        }}
      >
        <label>
          Name
          <input
            name="name"
            defaultValue="Speaker Type"
            required
            maxLength={255}
          />
        </label>
        <label>
          Type
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="select">Dropdown</option>
            <option value="multiselect">Multi-select</option>
            <option value="checkbox">Checkbox</option>
          </select>
        </label>
        {["select", "multiselect"].includes(type) && (
          <label>
            Options
            <input name="options" defaultValue="Internal, External" required />
          </label>
        )}
        <p className="modal-explainer">
          Field type becomes stable after data is collected. This field appears
          on every profile and in directory filters.
        </p>
        <button className="button" disabled={busy}>
          <Plus size={15} /> Add field
        </button>
      </form>
    </Modal>
  );
}

function InterestModal({
  events,
  busy,
  close,
  save,
}: {
  events: EventRecord[];
  busy: boolean;
  close: () => void;
  save: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      title="Create interest form"
      subtitle="Five-part year-round intake"
      close={close}
      wide
    >
      <form
        className="interest-builder"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          save({
            name: data.get("name"),
            title: data.get("title"),
            description: data.get("description") || null,
            mode: data.get("mode"),
            opensAt: data.get("opensAt")
              ? new Date(String(data.get("opensAt"))).toISOString()
              : null,
            closesAt: data.get("closesAt")
              ? new Date(String(data.get("closesAt"))).toISOString()
              : null,
            eventIds: data.getAll("eventIds"),
            fields: [
              {
                key: "linkedin",
                label: "LinkedIn profile",
                type: "url",
                required: false,
                options: [],
              },
              {
                key: "areas",
                label: "Areas of expertise",
                type: "text",
                required: true,
                options: [],
              },
            ],
            managerIds: [],
            notification: { organizerConfirmation: true },
            published: true,
          });
        }}
      >
        <fieldset>
          <legend>1 · Form details</legend>
          <div className="form-columns">
            <label>
              Internal name
              <input
                name="name"
                defaultValue="DevFlow speaker interest"
                required
              />
            </label>
            <label>
              Public title
              <input
                name="title"
                defaultValue="Share your expertise with DevFlow"
                required
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              name="description"
              rows={3}
              defaultValue="Tell our program team what you care about and where your experience could help our community."
            />
          </label>
          <label>
            Mode
            <select name="mode">
              <option value="speakers_only">Speakers only</option>
              <option value="sessions_and_speakers">Sessions & speakers</option>
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>2 · Future events</legend>
          <div className="event-choice-grid">
            {events
              .filter((event) => event.endsAt > new Date().toISOString())
              .map((event) => (
                <label key={event.id}>
                  <input type="checkbox" name="eventIds" value={event.id} />
                  {event.name}
                </label>
              ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>3 · Form fields</legend>
          <p>
            First name, last name, and email are always required. LinkedIn and
            Areas of expertise are included on this form.
          </p>
        </fieldset>
        <fieldset>
          <legend>4 · Managers</legend>
          <p>
            Workspace owners and admins can review submissions and the
            automatically created Identified pipeline cards.
          </p>
        </fieldset>
        <fieldset>
          <legend>5 · Notifications & availability</legend>
          <div className="form-columns">
            <label>
              Opens at
              <input type="datetime-local" name="opensAt" />
            </label>
            <label>
              Closes at
              <input type="datetime-local" name="closesAt" />
            </label>
          </div>
          <label className="choice-card">
            <input type="checkbox" defaultChecked />
            <span>
              <strong>Submission notifications</strong>
              <small>Notify the program team when interest arrives.</small>
            </span>
          </label>
        </fieldset>
        <button className="button" disabled={busy}>
          <Inbox size={15} /> Publish interest form
        </button>
      </form>
    </Modal>
  );
}

function ContactModal({
  data,
  fields,
  events,
  busy,
  close,
  save,
  addNote,
  merge,
  handoff,
}: {
  data: Record<string, unknown>;
  fields: CustomField[];
  events: EventRecord[];
  busy: boolean;
  close: () => void;
  save: (id: string, payload: Record<string, unknown>) => void;
  addNote: (id: string, body: string) => void;
  merge: (primaryId: string, duplicateIds: string[]) => void;
  handoff: (id: string, eventId: string) => void;
}) {
  const contact = data.contact as Contact;
  const notes = data.notes as Record<string, unknown>[];
  const connections = data.connections as Record<string, unknown>[];
  const sessions = data.sessions as Record<string, unknown>[];
  const activity = data.activity as Record<string, unknown>[];
  const emails = data.emails as Record<string, unknown>[];
  const duplicates = data.duplicates as Contact[];
  const [tab, setTab] = useState<
    "profile" | "notes" | "connections" | "activity"
  >("profile");
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const contactTabs = [
    { id: "profile", label: "Profile" },
    { id: "notes", label: "Internal notes", count: notes.length },
    {
      id: "connections",
      label: "Events & sessions",
      count: connections.length + sessions.length,
    },
    {
      id: "activity",
      label: "Activity & email",
      count: activity.length + emails.length,
    },
  ] as const;
  return (
    <Modal
      title={`${contact.firstName} ${contact.lastName}`}
      subtitle="Cross-event contact profile"
      close={close}
      wide
    >
      <div className="contact-profile-tabs">
        {contactTabs.map((item) => (
          <button
            type="button"
            className={tab === item.id ? "active" : ""}
            key={item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {"count" in item ? ` (${item.count})` : ""}
          </button>
        ))}
      </div>
      {duplicates.length > 0 && (
        <div className="duplicate-banner">
          <GitMerge />
          <span>
            <strong>Possible duplicate found</strong>
            <small>
              {duplicates.length} record
              {duplicates.length === 1 ? " has" : "s have"} the same name with a
              different email. Compare and merge{" "}
              {duplicates.length === 1 ? "it" : "them"} into this primary
              record.
            </small>
          </span>
          {!confirmingMerge ? (
            <button onClick={() => setConfirmingMerge(true)}>
              Compare & merge
            </button>
          ) : (
            <div
              className="duplicate-confirmation"
              role="group"
              aria-label="Confirm duplicate merge"
            >
              <strong>
                Merge {duplicates.length} duplicate record
                {duplicates.length === 1 ? "" : "s"} permanently?
              </strong>
              <small>
                Notes, event connections, and history move into this primary
                contact. Duplicate records are deleted. This cannot be undone.
              </small>
              <button
                onClick={() =>
                  merge(contact.id, duplicateContactIds(duplicates))
                }
              >
                Confirm merge of {duplicates.length} duplicate
                {duplicates.length === 1 ? "" : "s"}
              </button>
              <button onClick={() => setConfirmingMerge(false)}>
                Cancel merge
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "profile" && (
        <form
          className="crm-form contact-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            save(contact.id, {
              firstName: form.get("firstName"),
              lastName: form.get("lastName"),
              email: form.get("email"),
              pronouns: form.get("pronouns") || null,
              jobTitle: form.get("jobTitle") || null,
              company: form.get("company") || null,
              phone: form.get("phone") || null,
              region: form.get("region") || null,
              bio: form.get("bio") || null,
              tags: String(form.get("tags") || "")
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
              customFields: Object.fromEntries(
                fields.map((field) => [
                  field.id,
                  form.get(`field-${field.id}`),
                ]),
              ),
            });
          }}
        >
          <div className="profile-identity">
            <span>
              {contact.firstName[0]}
              {contact.lastName[0]}
            </span>
            <div>
              <strong>
                {contact.firstName} {contact.lastName}
              </strong>
              <small>
                {contact.jobTitle} · {contact.company}
              </small>
            </div>
          </div>
          <div className="form-columns">
            <label>
              First name
              <input
                name="firstName"
                defaultValue={contact.firstName}
                required
              />
            </label>
            <label>
              Last name
              <input name="lastName" defaultValue={contact.lastName} required />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue={contact.email}
                required
              />
            </label>
            <label>
              Pronouns
              <input name="pronouns" defaultValue={contact.pronouns ?? ""} />
            </label>
            <label>
              Job title
              <input name="jobTitle" defaultValue={contact.jobTitle ?? ""} />
            </label>
            <label>
              Company
              <input name="company" defaultValue={contact.company ?? ""} />
            </label>
            <label>
              Phone
              <input name="phone" defaultValue={contact.phone ?? ""} />
            </label>
            <label>
              Region
              <input name="region" defaultValue={contact.region ?? ""} />
            </label>
          </div>
          <label>
            Bio
            <textarea name="bio" rows={5} defaultValue={contact.bio ?? ""} />
          </label>
          <label>
            Tags
            <input name="tags" defaultValue={contact.tags.join(", ")} />
          </label>
          {fields.length > 0 && (
            <fieldset>
              <legend>Custom fields</legend>
              <div className="form-columns">
                {fields.map((field) => (
                  <label key={field.id}>
                    {field.name}
                    {field.fieldType === "select" ? (
                      <select
                        name={`field-${field.id}`}
                        defaultValue={String(
                          contact.customFields[field.id] ?? "",
                        )}
                      >
                        <option value="">Not set</option>
                        {field.options.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        name={`field-${field.id}`}
                        defaultValue={String(
                          contact.customFields[field.id] ?? "",
                        )}
                      />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="profile-actions">
            <button className="button" disabled={busy}>
              <Save size={15} /> Save profile
            </button>
            <label>
              Add to event
              <select
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value)
                    handoff(contact.id, event.target.value);
                }}
              >
                <option value="">Choose event</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </form>
      )}
      {tab === "notes" && (
        <section className="profile-timeline">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              addNote(contact.id, String(form.get("body")));
              event.currentTarget.reset();
            }}
          >
            <textarea
              name="body"
              rows={4}
              defaultValue="Met at DevFlow 2026 - strong on CI topics; shortlist for keynote."
              required
            />
            <button className="button" disabled={busy}>
              <MessageSquareText size={15} /> Save internal note
            </button>
          </form>
          {notes.map((note) => (
            <article key={String(note.id)}>
              <strong>{String(note.authorName)}</strong>
              <time>{formatDate(note.createdAt)}</time>
              <p>{String(note.body)}</p>
            </article>
          ))}
        </section>
      )}
      {tab === "connections" && (
        <section className="connections-grid">
          <div>
            <h3>Events</h3>
            {connections.map((item) => (
              <article key={String(item.id)}>
                <strong>{String(item.name)}</strong>
                <span>{formatDate(item.startsAt)}</span>
              </article>
            ))}
            {!connections.length && <p>No event handoffs yet.</p>}
          </div>
          <div>
            <h3>Sessions</h3>
            {sessions.map((item) => (
              <article key={String(item.id)}>
                <strong>{String(item.title)}</strong>
                <span>{String(item.eventName)}</span>
              </article>
            ))}
            {!sessions.length && <p>No linked sessions yet.</p>}
          </div>
        </section>
      )}
      {tab === "activity" && (
        <section className="profile-timeline">
          {emails.map((item) => (
            <article key={String(item.id)}>
              <strong>Email · {String(item.status)}</strong>
              <time>{formatDate(item.sentAt)}</time>
              <p>{String(item.subject)}</p>
            </article>
          ))}
          {activity.map((item) => (
            <article key={String(item.id)}>
              <strong>{String(item.action).replaceAll("_", " ")}</strong>
              <time>{formatDate(item.createdAt)}</time>
            </article>
          ))}
        </section>
      )}
    </Modal>
  );
}

function CardModal({
  data,
  busy,
  close,
  addNote,
}: {
  data: Record<string, unknown>;
  busy: boolean;
  close: () => void;
  addNote: (id: string, body: string) => void;
}) {
  const card = data.card as Card;
  const notes = data.notes as Record<string, unknown>[];
  const history = data.history as Record<string, unknown>[];
  return (
    <Modal
      title={`${card.firstName} ${card.lastName}`}
      subtitle={`${stageLabels[card.stage]} · Pipeline card`}
      close={close}
      wide
    >
      <div className="card-detail-grid">
        <section>
          <dl>
            <div>
              <dt>Company</dt>
              <dd>{card.company || "—"}</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{card.score ?? "—"}</dd>
            </div>
            <div>
              <dt>Rationale</dt>
              <dd>{card.rationale || "—"}</dd>
            </div>
          </dl>
          <h3>Internal notes</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              addNote(card.id, String(form.get("body")));
              event.currentTarget.reset();
            }}
          >
            <textarea
              name="body"
              rows={4}
              defaultValue="Left voicemail 2027-01-15; follow up next week."
              required
            />
            <button className="button" disabled={busy}>
              Save note
            </button>
          </form>
          {notes.map((note) => (
            <article key={String(note.id)}>
              <strong>{String(note.authorName)}</strong>
              <time>{formatDate(note.createdAt)}</time>
              <p>{String(note.body)}</p>
            </article>
          ))}
        </section>
        <section>
          <h3>Stage history</h3>
          {history.map((item) => (
            <article key={String(item.id)}>
              <i />
              <div>
                <strong>
                  {item.fromStage
                    ? `${stageLabels[String(item.fromStage)]} → `
                    : "Enrolled in "}
                  {stageLabels[String(item.toStage)]}
                </strong>
                <span>
                  {String(item.changedBy)} · {formatDate(item.createdAt)}
                </span>
                {Boolean(item.note) && <p>{String(item.note)}</p>}
              </div>
            </article>
          ))}
        </section>
      </div>
    </Modal>
  );
}

function formatDate(value: unknown) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(String(value)));
}
