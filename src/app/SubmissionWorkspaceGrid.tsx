import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Columns3,
  Download,
  Filter,
  Save,
  Search,
  Settings2,
  Share2,
  Tags,
  UsersRound,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { captureProductEvent } from "../lib/telemetry";

type Column = { id: string; visible: boolean; width: number };
type Filters = {
  formIds: string[];
  statuses: string[];
  trackIds: string[];
  formats: string[];
  submitter?: string;
  reviewerIds: string[];
  roundIds: string[];
  reviewCompletion: "any" | "complete" | "incomplete" | "unassigned";
  scoreMin?: number;
  scoreMax?: number;
  decisionStates: string[];
  notificationStates: string[];
  tagIds: string[];
  submittedFrom?: string;
  submittedTo?: string;
  custom: Array<{
    fieldId: string;
    operator: "equals" | "contains" | "not_empty" | "empty";
    value?: string;
  }>;
};
type Config = {
  columns: Column[];
  filters: Filters;
  sort: { field: string; direction: "asc" | "desc" };
  pageSize: number;
};
type Meta = {
  forms: Array<{ id: string; name: string }>;
  fields: Array<{
    id: string;
    formId: string;
    fieldKey: string;
    label: string;
    fieldType: string;
    formName: string;
  }>;
  tracks: Array<{ id: string; name: string; color: string }>;
  reviewers: Array<{ id: string; name: string }>;
  rounds: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  formats: string[];
  builtInColumns: string[];
};
type Row = {
  id: string;
  formId: string;
  formName: string;
  title: string;
  abstract: string;
  format: string | null;
  status: string;
  decisionState: string;
  submittedAt: string | null;
  updatedAt: string;
  submitterName: string | null;
  submitterEmail: string | null;
  submitterOrganization: string | null;
  reviewCount: number;
  completedReviewCount: number;
  averageScore: number | null;
  tracks: string;
  trackIds: string[];
  tags: string;
  tagIds: string[];
  notificationState: string;
  answers: Record<string, unknown>;
};
type View = {
  id: string;
  ownerUserId: string;
  ownerName: string;
  name: string;
  visibility: "personal" | "organization";
  config: Config;
  version: number;
  isDefault: boolean;
  canEdit: boolean;
};

const emptyFilters: Filters = {
  formIds: [],
  statuses: [],
  trackIds: [],
  formats: [],
  reviewerIds: [],
  roundIds: [],
  reviewCompletion: "any",
  decisionStates: [],
  notificationStates: [],
  tagIds: [],
  custom: [],
};
const defaultColumns: Column[] = [
  { id: "title", visible: true, width: 300 },
  { id: "formName", visible: true, width: 160 },
  { id: "submitterName", visible: true, width: 190 },
  { id: "tracks", visible: true, width: 160 },
  { id: "reviewProgress", visible: true, width: 145 },
  { id: "averageScore", visible: true, width: 120 },
  { id: "decisionState", visible: true, width: 155 },
  { id: "notificationState", visible: false, width: 145 },
  { id: "tags", visible: true, width: 170 },
  { id: "submittedAt", visible: true, width: 170 },
  { id: "status", visible: true, width: 130 },
];
const initialConfig: Config = {
  columns: defaultColumns,
  filters: emptyFilters,
  sort: { field: "submittedAt", direction: "desc" },
  pageSize: 50,
};
const labels: Record<string, string> = {
  title: "Proposal",
  formName: "Form",
  status: "Status",
  tracks: "Tracks",
  format: "Format",
  submitterName: "Submitter",
  submitterOrganization: "Organization",
  reviewProgress: "Review progress",
  averageScore: "Average score",
  decisionState: "Decision",
  notificationState: "Notification",
  tags: "Tags",
  submittedAt: "Submitted",
  updatedAt: "Updated",
};
const statusOptions = [
  "draft",
  "pending",
  "accepted_queue",
  "decline_queue",
  "accepted",
  "declined",
  "withdrawn",
];
const decisionOptions = [
  "none",
  "acceptance_staged",
  "waitlist_staged",
  "rejection_staged",
  "accepted",
  "waitlisted",
  "rejected",
];
const notificationOptions = [
  "not_prepared",
  "prepared",
  "queued",
  "processing",
  "sent",
  "delivered",
  "bounced",
  "failed",
  "cancelled",
];
const supportedSorts = [
  "title",
  "formName",
  "status",
  "format",
  "submitterName",
  "reviewProgress",
  "averageScore",
  "decisionState",
  "notificationState",
  "submittedAt",
  "updatedAt",
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "The request could not be completed.",
    );
  return result;
}
function selectedValues(event: ChangeEvent<HTMLSelectElement>) {
  return [...event.target.selectedOptions].map((option) => option.value);
}
function dateLabel(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}
function canonical(config: Config) {
  return JSON.stringify(config);
}

export function SubmissionWorkspaceGrid({
  eventId,
  onOpen,
}: {
  eventId: string;
  onOpen: (id: string) => void;
}) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [meta, setMeta] = useState<Meta>();
  const [views, setViews] = useState<View[]>([]);
  const [activeViewId, setActiveViewId] = useState(params.get("view") ?? "");
  const [viewName, setViewName] = useState("");
  const [viewShared, setViewShared] = useState(false);
  const [config, setConfig] = useState<Config>(() => ({
    ...initialConfig,
    sort: {
      field: params.get("sort") ?? "submittedAt",
      direction: params.get("direction") === "asc" ? "asc" : "desc",
    },
    filters: {
      ...emptyFilters,
      statuses: params.getAll("status"),
      formIds: params.getAll("form"),
      trackIds: params.getAll("track"),
    },
  }));
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allFiltered, setAllFiltered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showColumns, setShowColumns] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [newViewShared, setNewViewShared] = useState(false);
  const [bulkType, setBulkType] = useState("");
  const [bulkRound, setBulkRound] = useState("");
  const [bulkReviewers, setBulkReviewers] = useState<string[]>([]);
  const [bulkTag, setBulkTag] = useState("");
  const [preview, setPreview] = useState<{
    id: string;
    count: number;
    sample: Array<{ id: string; title: string }>;
    action: Record<string, unknown>;
    expiresAt: string;
  }>();

  const activeView = views.find((view) => view.id === activeViewId);
  const dirty = Boolean(
    activeView &&
    (canonical(config) !== canonical(activeView.config) ||
      viewName.trim() !== activeView.name ||
      viewShared !== (activeView.visibility === "organization")),
  );
  useEffect(() => {
    setViewName(activeView?.name ?? "");
    setViewShared(activeView?.visibility === "organization");
  }, [activeView?.id, activeView?.name, activeView?.visibility]);
  const loadCatalog = useCallback(async () => {
    const [metaResult, viewResult] = await Promise.all([
      api<Meta>(`/api/submission-workspace/events/${eventId}/meta`),
      api<{ views: View[] }>(
        `/api/submission-workspace/events/${eventId}/views`,
      ),
    ]);
    setMeta(metaResult);
    setViews(viewResult.views);
    const hydrate = (source: Config): Config => {
      const missingBuiltIns = metaResult.builtInColumns.filter(
        (id) => !source.columns.some((column) => column.id === id),
      );
      const missingFields = metaResult.fields.filter(
        (field) =>
          !source.columns.some((column) => column.id === `field:${field.id}`),
      );
      return {
        ...source,
        columns: [
          ...source.columns,
          ...missingBuiltIns.map((id) => ({ id, visible: false, width: 160 })),
          ...missingFields.map((field) => ({
            id: `field:${field.id}`,
            visible: false,
            width: 180,
          })),
        ],
      };
    };
    const requested =
      viewResult.views.find((view) => view.id === activeViewId) ??
      (!activeViewId
        ? viewResult.views.find((view) => view.isDefault)
        : undefined);
    if (requested) {
      setActiveViewId(requested.id);
      setConfig(hydrate(requested.config));
    } else setConfig((current) => hydrate(current));
  }, [eventId, activeViewId]);
  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{
        submissions: Row[];
        pagination: { page: number; pageSize: number; total: number };
      }>(`/api/submission-workspace/events/${eventId}/query`, {
        method: "POST",
        body: JSON.stringify({
          search: search || undefined,
          filters: config.filters,
          sort: config.sort,
          page,
          pageSize: config.pageSize,
        }),
      });
      setRows(result.submissions);
      setTotal(result.pagination.total);
      setError("");
      const url = new URL(window.location.href);
      ["status", "form", "track"].forEach((key) =>
        url.searchParams.delete(key),
      );
      config.filters.statuses.forEach((value) =>
        url.searchParams.append("status", value),
      );
      config.filters.formIds.forEach((value) =>
        url.searchParams.append("form", value),
      );
      config.filters.trackIds.forEach((value) =>
        url.searchParams.append("track", value),
      );
      url.searchParams.set("sort", config.sort.field);
      url.searchParams.set("direction", config.sort.direction);
      activeViewId
        ? url.searchParams.set("view", activeViewId)
        : url.searchParams.delete("view");
      window.history.replaceState(null, "", url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Submissions could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [eventId, config, search, page, activeViewId]);
  useEffect(() => {
    loadCatalog().catch((cause: Error) => setError(cause.message));
  }, [loadCatalog]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadRows(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadRows, search]);
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    setAllFiltered(false);
  }, [config.filters, config.sort, search]);

  function changeFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setConfig((current) => ({
      ...current,
      filters: { ...current.filters, [key]: value },
    }));
  }
  function selectView(id: string) {
    setActiveViewId(id);
    const view = views.find((item) => item.id === id);
    if (view) setConfig(view.config);
    else setConfig(initialConfig);
  }
  async function createView() {
    if (!newViewName.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ view: View }>(
        `/api/submission-workspace/events/${eventId}/views`,
        {
          method: "POST",
          body: JSON.stringify({
            name: newViewName,
            visibility: newViewShared ? "organization" : "personal",
            config,
          }),
        },
      );
      setViews((current) => [...current, result.view]);
      setActiveViewId(result.view.id);
      setNewViewName("");
      captureProductEvent("submission_view_created", {
        event_id: eventId,
        shared: newViewShared,
      });
    } catch (cause) {
      setError((cause as Error).message);
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function updateView() {
    if (!activeView?.canEdit || !viewName.trim()) return;
    await api(
      `/api/submission-workspace/events/${eventId}/views/${activeView.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: viewName.trim(),
          visibility: viewShared ? "organization" : "personal",
          config,
        }),
      },
    );
    await loadCatalog();
  }
  async function duplicateView() {
    if (!activeView) return;
    const result = await api<{ id: string }>(
      `/api/submission-workspace/events/${eventId}/views/${activeView.id}/duplicate`,
      {
        method: "POST",
        body: JSON.stringify({ name: `${activeView.name} copy` }),
      },
    );
    await loadCatalog();
    setActiveViewId(result.id);
  }
  async function defaultView() {
    if (!activeView) return;
    await api(
      `/api/submission-workspace/events/${eventId}/views/${activeView.id}/default`,
      { method: "PUT" },
    );
    await loadCatalog();
  }
  async function deleteView() {
    if (!activeView?.canEdit || !window.confirm(`Delete “${activeView.name}”?`))
      return;
    await api(
      `/api/submission-workspace/events/${eventId}/views/${activeView.id}`,
      { method: "DELETE" },
    );
    setActiveViewId("");
    setConfig(initialConfig);
    await loadCatalog();
  }
  function moveColumn(index: number, delta: number) {
    setConfig((current) => {
      const columns = [...current.columns];
      const next = index + delta;
      if (next < 0 || next >= columns.length) return current;
      [columns[index], columns[next]] = [columns[next], columns[index]];
      return { ...current, columns };
    });
  }
  function allOnPage(checked: boolean) {
    setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
    if (!checked) setAllFiltered(false);
  }
  function bulkAction(): Record<string, unknown> | undefined {
    if (bulkType === "assign_reviewers" && bulkRound && bulkReviewers.length)
      return {
        type: bulkType,
        roundId: bulkRound,
        reviewerUserIds: bulkReviewers,
      };
    if (bulkType === "tag_add" && bulkTag)
      return { type: "tags", addTagIds: [bulkTag], removeTagIds: [] };
    if (bulkType === "tag_remove" && bulkTag)
      return { type: "tags", addTagIds: [], removeTagIds: [bulkTag] };
    if (bulkType.startsWith("decision:"))
      return { type: "decision", state: bulkType.slice(9) };
    if (bulkType.startsWith("status:"))
      return { type: "status", status: bulkType.slice(7) };
    if (bulkType.startsWith("communication:"))
      return { type: "communication", category: bulkType.slice(14) };
    if (bulkType.startsWith("export:"))
      return {
        type: "export",
        format: bulkType.slice(7),
        columns: config.columns
          .filter((column) => column.visible)
          .map((column) => column.id),
      };
  }
  async function previewBulk() {
    const action = bulkAction();
    if (!action) return;
    const selection = allFiltered
      ? {
          mode: "filtered",
          query: {
            search: search || undefined,
            filters: config.filters,
            sort: config.sort,
          },
        }
      : { mode: "selected", ids: [...selected] };
    setBusy(true);
    try {
      const result = await api<{ preview: typeof preview }>(
        `/api/submission-workspace/events/${eventId}/bulk/preview`,
        { method: "POST", body: JSON.stringify({ selection, action }) },
      );
      setPreview(result.preview);
    } catch (cause) {
      setError((cause as Error).message);
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function executeBulk() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await api<{
        ok?: boolean;
        changedCount?: number;
        requiresWorkflow?: boolean;
        requiresDownload?: boolean;
        url?: string;
      }>(
        `/api/submission-workspace/events/${eventId}/bulk/${preview.id}/execute`,
        { method: "POST", body: JSON.stringify({ confirmed: true }) },
      );
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      setPreview(undefined);
      setSelected(new Set());
      setAllFiltered(false);
      await Promise.all([loadRows(), loadCatalog()]);
      captureProductEvent("submission_bulk_completed", {
        event_id: eventId,
        action: String(preview.action.type),
        count: result.changedCount ?? 0,
      });
    } catch (cause) {
      setError((cause as Error).message);
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  const visibleColumns = config.columns.filter((column) => column.visible);
  const grid = `44px ${visibleColumns.map((column) => `${column.width}px`).join(" ")} 132px`;
  function cell(row: Row, column: string) {
    if (column.startsWith("field:")) {
      const field = meta?.fields.find((item) => `field:${item.id}` === column);
      const value = field ? row.answers[field.fieldKey] : undefined;
      return Array.isArray(value) ? value.join(", ") : String(value ?? "—");
    }
    if (column === "reviewProgress")
      return `${row.completedReviewCount}/${row.reviewCount}`;
    if (column === "submittedAt" || column === "updatedAt")
      return dateLabel(row[column]);
    if (column === "averageScore") return row.averageScore ?? "—";
    return String(row[column as keyof Row] ?? "—").replaceAll("_", " ");
  }

  return (
    <section
      className="submission-workspace"
      aria-label="Configurable submission workspace"
    >
      {error && (
        <div className="form-status form-status-error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="submission-view-bar">
        <label>
          Saved view
          <select
            value={activeViewId}
            onChange={(event) => selectView(event.target.value)}
          >
            <option value="">Unsaved view</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
                {view.visibility === "organization" ? " · shared" : ""}
                {view.isDefault ? " · default" : ""}
              </option>
            ))}
          </select>
        </label>
        {dirty && <span className="view-dirty">Unsaved changes</span>}
        <div className="view-actions">
          {activeView?.canEdit && (
            <>
              <input
                aria-label="Saved view name"
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={viewShared}
                  onChange={(event) => setViewShared(event.target.checked)}
                />
                <Share2 size={14} /> Shared
              </label>
              <button
                onClick={updateView}
                disabled={!dirty || !viewName.trim()}
              >
                <Save size={15} /> Update
              </button>
            </>
          )}
          {activeView && <button onClick={duplicateView}>Duplicate</button>}
          {activeView && <button onClick={defaultView}>Make default</button>}
          {activeView?.canEdit && <button onClick={deleteView}>Delete</button>}
        </div>
        <div className="new-view">
          <input
            value={newViewName}
            onChange={(event) => setNewViewName(event.target.value)}
            placeholder="New view name"
            aria-label="New saved view name"
          />
          <label>
            <input
              type="checkbox"
              checked={newViewShared}
              onChange={(event) => setNewViewShared(event.target.checked)}
            />
            <Share2 size={14} /> Share
          </label>
          <button onClick={createView} disabled={busy || !newViewName.trim()}>
            Save view
          </button>
        </div>
      </div>
      <div className="submission-query-bar">
        <label className="workspace-search">
          <Search size={16} />
          <span className="sr-only">Search proposals</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, abstract, speaker, organization, or searchable fields"
          />
        </label>
        <button
          aria-expanded={showFilters}
          onClick={() => setShowFilters((value) => !value)}
        >
          <Filter size={16} /> Filters
        </button>
        <button
          aria-expanded={showColumns}
          onClick={() => setShowColumns((value) => !value)}
        >
          <Columns3 size={16} /> Columns
        </button>
        <label>
          Sort
          <select
            value={config.sort.field}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                sort: { ...current.sort, field: event.target.value },
              }))
            }
          >
            {supportedSorts.map((column) => (
              <option key={column} value={column}>
                {labels[column]}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label={`Sort ${config.sort.direction === "asc" ? "descending" : "ascending"}`}
          onClick={() =>
            setConfig((current) => ({
              ...current,
              sort: {
                ...current.sort,
                direction: current.sort.direction === "asc" ? "desc" : "asc",
              },
            }))
          }
        >
          {config.sort.direction === "asc" ? <ArrowUp /> : <ArrowDown />}
        </button>
      </div>
      {showFilters && meta && (
        <div className="submission-advanced-filters">
          <Multi
            label="Form"
            values={config.filters.formIds}
            options={meta.forms}
            onChange={(value) => changeFilter("formIds", value)}
          />
          <Multi
            label="Status"
            values={config.filters.statuses}
            options={statusOptions.map((value) => ({
              id: value,
              name: value.replaceAll("_", " "),
            }))}
            onChange={(value) => changeFilter("statuses", value)}
          />
          <Multi
            label="Track"
            values={config.filters.trackIds}
            options={meta.tracks}
            onChange={(value) => changeFilter("trackIds", value)}
          />
          <Multi
            label="Format"
            values={config.filters.formats}
            options={meta.formats.map((value) => ({ id: value, name: value }))}
            onChange={(value) => changeFilter("formats", value)}
          />
          <Multi
            label="Reviewer"
            values={config.filters.reviewerIds}
            options={meta.reviewers}
            onChange={(value) => changeFilter("reviewerIds", value)}
          />
          <Multi
            label="Review round"
            values={config.filters.roundIds}
            options={meta.rounds}
            onChange={(value) => changeFilter("roundIds", value)}
          />
          <label>
            Review completion
            <select
              value={config.filters.reviewCompletion}
              onChange={(event) =>
                changeFilter(
                  "reviewCompletion",
                  event.target.value as Filters["reviewCompletion"],
                )
              }
            >
              <option value="any">Any</option>
              <option value="complete">At least one complete</option>
              <option value="incomplete">Incomplete assigned review</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
          <label>
            Minimum score
            <input
              type="number"
              value={config.filters.scoreMin ?? ""}
              onChange={(event) =>
                changeFilter(
                  "scoreMin",
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
                )
              }
            />
          </label>
          <label>
            Maximum score
            <input
              type="number"
              value={config.filters.scoreMax ?? ""}
              onChange={(event) =>
                changeFilter(
                  "scoreMax",
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
                )
              }
            />
          </label>
          <Multi
            label="Decision"
            values={config.filters.decisionStates}
            options={decisionOptions.map((value) => ({
              id: value,
              name: value.replaceAll("_", " "),
            }))}
            onChange={(value) => changeFilter("decisionStates", value)}
          />
          <Multi
            label="Notification"
            values={config.filters.notificationStates}
            options={notificationOptions.map((value) => ({
              id: value,
              name: value.replaceAll("_", " "),
            }))}
            onChange={(value) => changeFilter("notificationStates", value)}
          />
          <Multi
            label="Tags"
            values={config.filters.tagIds}
            options={meta.tags}
            onChange={(value) => changeFilter("tagIds", value)}
          />
          <label>
            Submitted after
            <input
              type="date"
              value={config.filters.submittedFrom?.slice(0, 10) ?? ""}
              onChange={(event) =>
                changeFilter(
                  "submittedFrom",
                  event.target.value
                    ? `${event.target.value}T00:00:00.000Z`
                    : undefined,
                )
              }
            />
          </label>
          <label>
            Submitted before
            <input
              type="date"
              value={config.filters.submittedTo?.slice(0, 10) ?? ""}
              onChange={(event) =>
                changeFilter(
                  "submittedTo",
                  event.target.value
                    ? `${event.target.value}T23:59:59.999Z`
                    : undefined,
                )
              }
            />
          </label>
          <label>
            Submitter
            <input
              value={config.filters.submitter ?? ""}
              onChange={(event) =>
                changeFilter("submitter", event.target.value || undefined)
              }
              placeholder="Name, email, organization"
            />
          </label>
          <CustomFilters
            fields={meta.fields}
            values={config.filters.custom}
            onChange={(value) => changeFilter("custom", value)}
          />
          <button
            className="clear-filters"
            onClick={() =>
              setConfig((current) => ({ ...current, filters: emptyFilters }))
            }
          >
            Clear filters
          </button>
        </div>
      )}
      {showColumns && meta && (
        <div className="column-config" aria-label="Column configuration">
          <p>
            Use the arrow buttons for an accessible alternative to drag
            ordering.
          </p>
          {config.columns.map((column, index) => (
            <div key={column.id}>
              <label>
                <input
                  type="checkbox"
                  checked={column.visible}
                  onChange={(event) =>
                    setConfig((current) => {
                      const exists = current.columns.some(
                        (item) => item.id === column.id,
                      );
                      return {
                        ...current,
                        columns: exists
                          ? current.columns.map((item) =>
                              item.id === column.id
                                ? { ...item, visible: event.target.checked }
                                : item,
                            )
                          : [
                              ...current.columns,
                              { ...column, visible: event.target.checked },
                            ],
                      };
                    })
                  }
                />
                {labels[column.id] ??
                  meta.fields.find((field) => `field:${field.id}` === column.id)
                    ?.label ??
                  column.id}
              </label>
              <label>
                Width
                <input
                  type="number"
                  min="80"
                  max="800"
                  value={column.width}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      columns: current.columns.map((item) =>
                        item.id === column.id
                          ? { ...item, width: Number(event.target.value) }
                          : item,
                      ),
                    }))
                  }
                />
              </label>
              <button
                onClick={() => moveColumn(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${column.id} left`}
              >
                <ArrowUp />
              </button>
              <button
                onClick={() => moveColumn(index, 1)}
                disabled={index === config.columns.length - 1}
                aria-label={`Move ${column.id} right`}
              >
                <ArrowDown />
              </button>
            </div>
          ))}
        </div>
      )}
      {(selected.size > 0 || allFiltered) && (
        <div className="bulk-toolbar">
          <CheckSquare />
          <strong>
            {allFiltered
              ? `${total} filtered proposals`
              : `${selected.size} selected`}
          </strong>
          {selected.size === rows.length &&
            !allFiltered &&
            total > rows.length && (
              <button onClick={() => setAllFiltered(true)}>
                Select all {total} filtered results
              </button>
            )}
          <label>
            Bulk action
            <select
              value={bulkType}
              onChange={(event) => setBulkType(event.target.value)}
            >
              <option value="">Choose action…</option>
              <option value="assign_reviewers">Assign reviewers</option>
              <option value="tag_add">Add tag</option>
              <option value="tag_remove">Remove tag</option>
              <option value="decision:acceptance_staged">
                Stage decision: Acceptance
              </option>
              <option value="decision:waitlist_staged">
                Stage decision: Waitlist
              </option>
              <option value="decision:rejection_staged">
                Stage decision: Rejection
              </option>
              <option value="status:pending">Move to review</option>
              <option value="status:withdrawn">Withdraw</option>
              <option value="communication:deadline_reminder">
                Send deadline reminder
              </option>
              <option value="communication:decision_acceptance">
                Send staged acceptances
              </option>
              <option value="export:csv">Export visible columns (CSV)</option>
              <option value="export:xlsx">Export visible columns (XLSX)</option>
            </select>
          </label>
          {bulkType === "assign_reviewers" && (
            <>
              <select
                aria-label="Review round"
                value={bulkRound}
                onChange={(event) => setBulkRound(event.target.value)}
              >
                <option value="">Choose round</option>
                {meta?.rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    {round.name}
                  </option>
                ))}
              </select>
              <select
                multiple
                aria-label="Reviewers"
                value={bulkReviewers}
                onChange={(event) => setBulkReviewers(selectedValues(event))}
              >
                {meta?.reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {["tag_add", "tag_remove"].includes(bulkType) && (
            <select
              aria-label="Tag"
              value={bulkTag}
              onChange={(event) => setBulkTag(event.target.value)}
            >
              <option value="">Choose tag</option>
              {meta?.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="button button-small"
            onClick={previewBulk}
            disabled={busy || !bulkAction()}
          >
            Preview action
          </button>
          <button
            onClick={() => {
              setSelected(new Set());
              setAllFiltered(false);
            }}
          >
            Clear
          </button>
        </div>
      )}
      <div
        className="configurable-table"
        role="table"
        aria-label="Submissions"
        aria-busy={loading}
      >
        <div
          className="configurable-row configurable-head"
          role="row"
          style={{ gridTemplateColumns: grid }}
        >
          <span role="columnheader">
            <input
              type="checkbox"
              aria-label="Select this page"
              checked={rows.length > 0 && selected.size === rows.length}
              onChange={(event) => allOnPage(event.target.checked)}
            />
          </span>
          {visibleColumns.map((column) => (
            <button
              key={column.id}
              role="columnheader"
              onClick={() =>
                setConfig((current) => ({
                  ...current,
                  sort: {
                    field: column.id,
                    direction:
                      current.sort.field === column.id &&
                      current.sort.direction === "asc"
                        ? "desc"
                        : "asc",
                  },
                }))
              }
            >
              {labels[column.id] ??
                meta?.fields.find((field) => `field:${field.id}` === column.id)
                  ?.label ??
                column.id}
              {config.sort.field === column.id
                ? config.sort.direction === "asc"
                  ? " ↑"
                  : " ↓"
                : ""}
            </button>
          ))}
          <span role="columnheader">Actions</span>
        </div>
        {rows.map((row) => (
          <div
            className="configurable-row"
            role="row"
            style={{ gridTemplateColumns: grid }}
            key={row.id}
          >
            <span role="cell">
              <input
                type="checkbox"
                aria-label={`Select ${row.title}`}
                checked={selected.has(row.id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    event.target.checked
                      ? next.add(row.id)
                      : next.delete(row.id);
                    return next;
                  })
                }
              />
            </span>
            {visibleColumns.map((column) => (
              <span role="cell" key={column.id}>
                <button
                  onClick={() => onOpen(row.id)}
                  aria-label={`${
                    labels[column.id] ??
                    meta?.fields.find(
                      (field) => `field:${field.id}` === column.id,
                    )?.label ??
                    column.id
                  }: ${String(cell(row, column.id) || "Not provided")}`}
                  title={String(cell(row, column.id) || "Not provided")}
                >
                  {cell(row, column.id) || "—"}
                </button>
              </span>
            ))}
            <span role="cell">
              <button
                aria-label={`Open submission: ${row.title}`}
                onClick={() => onOpen(row.id)}
              >
                Open submission
              </button>
            </span>
          </div>
        ))}
        {!loading && !rows.length && (
          <div role="row">
            <div className="workspace-empty" role="cell">
              <strong>No matching proposals</strong>
              <span>
                Clear this view to look again, or open the call for proposals to
                publish and share the submission form.
              </span>
              <div className="inline-actions">
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setActiveViewId("");
                    setConfig((current) => ({
                      ...current,
                      filters: emptyFilters,
                    }));
                    setPage(1);
                  }}
                >
                  Clear all proposal filters
                </button>
                <a href={`/app/events/${eventId}/cfp`}>
                  Open call for proposals
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="workspace-pagination">
        <span>
          {total
            ? `${(page - 1) * config.pageSize + 1}–${Math.min(page * config.pageSize, total)} of ${total}`
            : "0 proposals"}
        </span>
        <label>
          Rows
          <select
            value={config.pageSize}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                pageSize: Number(event.target.value),
              }))
            }
          >
            {[25, 50, 100].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          disabled={page === 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </button>
        <button
          disabled={page * config.pageSize >= total}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>
      {preview && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(undefined);
          }}
        >
          <section
            className="bulk-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-preview-title"
          >
            <header>
              <div>
                <p className="kicker">Confirm bulk action</p>
                <h2 id="bulk-preview-title">
                  Apply to {preview.count} proposal
                  {preview.count === 1 ? "" : "s"}?
                </h2>
              </div>
              <button
                className="button button-small button-ghost"
                data-dismiss
                onClick={() => setPreview(undefined)}
              >
                <X size={16} /> Close bulk-action preview
              </button>
            </header>
            <p>
              This preview is based on the current persisted result set. If it
              changes, ProgramLoom will require a fresh preview.
            </p>
            <ul>
              {preview.sample.map((item) => (
                <li key={item.id}>{item.title}</li>
              ))}
            </ul>
            {preview.count > preview.sample.length && (
              <p>…and {preview.count - preview.sample.length} more.</p>
            )}
            <div>
              <button onClick={() => setPreview(undefined)}>Cancel</button>
              <button className="button" onClick={executeBulk} disabled={busy}>
                {busy ? "Applying…" : "Confirm and continue"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function Multi({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: Array<{ id: string; name: string }>;
  onChange: (values: string[]) => void;
}) {
  return (
    <label>
      {label}
      <select
        multiple
        value={values}
        onChange={(event) => onChange(selectedValues(event))}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <small>Use Ctrl/⌘ to combine</small>
    </label>
  );
}
function CustomFilters({
  fields,
  values,
  onChange,
}: {
  fields: Meta["fields"];
  values: Filters["custom"];
  onChange: (value: Filters["custom"]) => void;
}) {
  return (
    <fieldset className="custom-filters">
      <legend>Custom fields</legend>
      {values.map((filter, index) => (
        <div key={`${filter.fieldId}:${index}`}>
          <select
            aria-label="Custom field"
            value={filter.fieldId}
            onChange={(event) =>
              onChange(
                values.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, fieldId: event.target.value }
                    : item,
                ),
              )
            }
          >
            {fields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.formName} · {field.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Custom field operator"
            value={filter.operator}
            onChange={(event) =>
              onChange(
                values.map((item, itemIndex) =>
                  itemIndex === index
                    ? {
                        ...item,
                        operator: event.target.value as typeof item.operator,
                      }
                    : item,
                ),
              )
            }
          >
            <option value="equals">Equals</option>
            <option value="contains">Contains</option>
            <option value="not_empty">Is not empty</option>
            <option value="empty">Is empty</option>
          </select>
          {!["empty", "not_empty"].includes(filter.operator) && (
            <input
              aria-label="Custom field value"
              value={filter.value ?? ""}
              onChange={(event) =>
                onChange(
                  values.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, value: event.target.value }
                      : item,
                  ),
                )
              }
            />
          )}
          <button
            aria-label="Remove custom filter"
            onClick={() =>
              onChange(values.filter((_, itemIndex) => itemIndex !== index))
            }
          >
            <X />
          </button>
        </div>
      ))}
      <button
        disabled={!fields.length}
        onClick={() =>
          onChange([
            ...values,
            { fieldId: fields[0]?.id ?? "", operator: "contains", value: "" },
          ])
        }
      >
        Add custom filter
      </button>
    </fieldset>
  );
}
