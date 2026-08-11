import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
  Webhook,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { captureProductEvent } from "../lib/telemetry";
import { SidebarUser } from "./SidebarUser";

type User = { id: string; email: string; name: string };
type Organization = { id: string; name: string; role: string };
type Event = { id: string; name: string };
type Token = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  eventIds: string[];
  hidePii: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
type WebhookRecord = {
  id: string;
  name: string;
  endpointUrl: string;
  eventIds: string[];
  entityTypes: string[];
  enabled: boolean;
  deliveryCount: number;
  failedCount: number;
};
type WebhookDelivery = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  failureReason: string | null;
  createdAt: string;
  deliveredAt: string | null;
};
type OAuthClient = {
  id: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  confidential: boolean;
  revokedAt: string | null;
};
type Data = {
  scopes: string[];
  tokens: Token[];
  webhooks: WebhookRecord[];
  oauthClients: OAuthClient[];
  usage: Array<{
    tokenId: string;
    requests: number;
    failures: number;
    lastRequestAt: string;
  }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(result.error?.message ?? "The change could not be saved.");
  return result;
}

function localDateTimeInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function DeveloperSettings({ user }: { user: User }) {
  const initialQuery = new URLSearchParams(window.location.search);
  const requested = initialQuery.get("organization");
  const requestedTab = initialQuery.get("tab");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState(requested ?? "");
  const [events, setEvents] = useState<Event[]>([]);
  const [data, setData] = useState<Data>();
  const [tab, setTabState] = useState<"tokens" | "webhooks" | "oauth">(
    requestedTab === "webhooks" || requestedTab === "oauth"
      ? requestedTab
      : "tokens",
  );
  const [secret, setSecret] = useState<{
    label: string;
    value: string;
  }>();
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookRecord>();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ organizations: Organization[] }>("/api/organizations")
      .then(({ organizations: rows }) => {
        const allowed = rows.filter((item) =>
          ["owner", "admin"].includes(item.role),
        );
        setOrganizations(allowed);
        if (!allowed.some((item) => item.id === requested))
          setOrganizationId(allowed[0]?.id ?? "");
      })
      .catch((error: Error) =>
        setFeedback({ kind: "error", message: error.message }),
      );
  }, []);

  async function load(id = organizationId) {
    if (!id) return;
    const [developer, eventResult] = await Promise.all([
      api<Data>(`/api/developer/organizations/${id}`),
      api<{ events: Event[] }>(`/api/organizations/${id}/events`),
    ]);
    setData(developer);
    setEvents(eventResult.events);
  }
  useEffect(() => {
    setData(undefined);
    load().catch((error: Error) =>
      setFeedback({ kind: "error", message: error.message }),
    );
    if (organizationId) {
      const query = new URLSearchParams(window.location.search);
      query.set("organization", organizationId);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${query}`,
      );
    }
  }, [organizationId]);

  const organization = organizations.find((item) => item.id === organizationId);
  const usage = useMemo(
    () => new Map((data?.usage ?? []).map((item) => [item.tokenId, item])),
    [data],
  );

  function setTab(value: "tokens" | "webhooks" | "oauth") {
    setTabState(value);
    captureProductEvent("developer_settings_tab_opened", { tab: value });
    const query = new URLSearchParams(window.location.search);
    query.set("tab", value);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${query}`,
    );
  }

  async function run(operation: () => Promise<unknown>, message: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await operation();
      await load();
      setFeedback({ kind: "success", message });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "The change failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await api<{ token: { value: string; name: string } }>(
      `/api/developer/organizations/${organizationId}/tokens`,
      {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          scopes: form.getAll("scopes"),
          eventIds: form.getAll("eventIds"),
          hidePii: form.get("hidePii") === "on",
          expiresAt: form.get("expiresAt")
            ? new Date(String(form.get("expiresAt"))).toISOString()
            : null,
        }),
      },
    );
    setSecret({
      label: `${result.token.name} API token`,
      value: result.token.value,
    });
    captureProductEvent("developer_api_token_created", {
      scope_count: form.getAll("scopes").length,
      event_restricted: form.getAll("eventIds").length > 0,
      pii_hidden: form.get("hidePii") === "on",
    });
    formElement.reset();
    await load();
    setFeedback({
      kind: "success",
      message:
        "API token created. Copy it now; ProgramLoom will not show it again.",
    });
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await api<{ webhook: { secret: string; name: string } }>(
      `/api/developer/organizations/${organizationId}/webhooks`,
      {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          endpointUrl: form.get("endpointUrl"),
          eventIds: form.getAll("eventIds"),
          entityTypes: String(form.get("entityTypes") ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          enabled: true,
        }),
      },
    );
    setSecret({
      label: `${result.webhook.name} signing secret`,
      value: result.webhook.secret,
    });
    captureProductEvent("developer_webhook_created", {
      event_restricted: form.getAll("eventIds").length > 0,
      entity_filter_count: String(form.get("entityTypes") ?? "")
        .split(",")
        .filter((item) => item.trim()).length,
    });
    formElement.reset();
    await load();
    setFeedback({
      kind: "success",
      message: "Webhook created. Copy its signing secret now.",
    });
  }

  async function createOAuthClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await api<{
      client: { id: string; name: string; clientSecret: string | null };
    }>(`/api/developer/organizations/${organizationId}/oauth-clients`, {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        redirectUris: String(form.get("redirectUris"))
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
        scopes: form.getAll("scopes"),
        confidential: form.get("confidential") === "on",
      }),
    });
    if (result.client.clientSecret)
      setSecret({
        label: `${result.client.name} client secret`,
        value: result.client.clientSecret,
      });
    captureProductEvent("developer_oauth_client_created", {
      confidential: form.get("confidential") === "on",
      scope_count: form.getAll("scopes").length,
    });
    await load();
    setFeedback({
      kind: "success",
      message: `OAuth client ${result.client.id} created.`,
    });
    formElement.reset();
  }

  async function showDeliveries(webhook: WebhookRecord) {
    setBusy(true);
    try {
      const result = await api<{ deliveries: WebhookDelivery[] }>(
        `/api/developer/organizations/${organizationId}/webhooks/${webhook.id}/deliveries`,
      );
      setSelectedWebhook(webhook);
      setDeliveries(result.deliveries);
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Delivery history failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-shell developer-settings-shell">
      <aside className="workspace-sidebar">
        <a className="wordmark sidebar-wordmark" href="/">
          <span className="mark" aria-hidden="true">
            PL
          </span>{" "}
          ProgramLoom
        </a>
        <a className="back-link" href="/app">
          <ArrowLeft size={15} /> Events
        </a>
        <label className="workspace-switcher">
          Workspace
          <select
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            {organizations.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <nav className="app-nav" aria-label="Workspace settings">
          <button
            className={tab === "tokens" ? "active" : ""}
            onClick={() => setTab("tokens")}
          >
            <KeyRound size={17} /> API tokens
          </button>
          <button
            className={tab === "webhooks" ? "active" : ""}
            onClick={() => setTab("webhooks")}
          >
            <Webhook size={17} /> Webhooks
          </button>
          <button
            className={tab === "oauth" ? "active" : ""}
            onClick={() => setTab("oauth")}
          >
            <Link2 size={17} /> OAuth clients
          </button>
          <a href="/developers">Developer documentation</a>
        </nav>
        <SidebarUser user={user} />
      </aside>
      <main id="main-content" className="workspace-main developer-settings">
        <header className="workspace-header">
          <div>
            <p className="kicker">Workspace settings</p>
            <h1>Developer platform</h1>
            <p>
              Connect {organization?.name ?? "this workspace"} to trusted
              systems without sharing organizer sessions or private operations.
            </p>
          </div>
          <a className="button button-ghost" href="/developers">
            Read API guide
          </a>
        </header>
        {feedback && (
          <div
            className={`form-status form-status-${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </div>
        )}
        {secret && (
          <section
            className="secret-reveal"
            role="alert"
            aria-labelledby="secret-title"
          >
            <div>
              <p className="kicker">Shown once</p>
              <h2 id="secret-title">Copy {secret.label}</h2>
              <p>
                Store this value in your secret manager. Closing this panel
                permanently hides it.
              </p>
            </div>
            <code>{secret.value}</code>
            <button
              className="button"
              onClick={() => void navigator.clipboard.writeText(secret.value)}
            >
              <Copy size={15} /> Copy secret
            </button>
            <button
              className="button button-ghost"
              onClick={() => setSecret(undefined)}
            >
              I stored it — close
            </button>
          </section>
        )}
        {!data ? (
          <div className="loading-page">
            <LoaderCircle className="spin" /> Loading developer settings…
          </div>
        ) : tab === "tokens" ? (
          <div className="developer-settings-grid">
            <section className="panel-card">
              <h2>Create API token</h2>
              <p>
                Tokens are hashed, restricted to this organization, and revealed
                once. Read access is the safest starting point.
              </p>
              <form onSubmit={createToken} className="developer-form">
                <label>
                  Name
                  <input name="name" placeholder="Schedule website" required />
                </label>
                <label>
                  Optional expiration
                  <input name="expiresAt" type="datetime-local" />
                </label>
                <fieldset>
                  <legend>Event access</legend>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      name="allEvents"
                      defaultChecked
                      disabled
                    />
                    <span>
                      <strong>All events unless selected below</strong>
                      <small>Selecting events restricts the token.</small>
                    </span>
                  </label>
                  {events.map((item) => (
                    <label className="check-row" key={item.id}>
                      <input type="checkbox" name="eventIds" value={item.id} />
                      <span>{item.name}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Scopes</legend>
                  {data.scopes.map((item) => (
                    <label className="check-row" key={item}>
                      <input
                        type="checkbox"
                        name="scopes"
                        value={item}
                        defaultChecked={item.startsWith("read:")}
                      />
                      <span>{item}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="check-row">
                  <input type="checkbox" name="hidePii" defaultChecked />
                  <span>
                    <strong>Hide personally identifiable information</strong>
                    <small>
                      Recommended. Email addresses and private fields remain
                      masked.
                    </small>
                  </span>
                </label>
                <button className="button" disabled={busy}>
                  Create API token
                </button>
              </form>
            </section>
            <section className="panel-card developer-records">
              <h2>API tokens</h2>
              {data.tokens.map((token) => {
                const stats = usage.get(token.id);
                return (
                  <article
                    key={token.id}
                    className={token.revokedAt ? "revoked" : ""}
                  >
                    <header>
                      <div>
                        <strong>{token.name}</strong>
                        <code>{token.tokenPrefix}…</code>
                      </div>
                      <span>
                        {token.revokedAt
                          ? "Revoked"
                          : token.expiresAt &&
                              new Date(token.expiresAt) < new Date()
                            ? "Expired"
                            : "Active"}
                      </span>
                    </header>
                    <p>
                      {token.hidePii ? "PII hidden" : "PII permitted"} ·{" "}
                      {token.eventIds.length
                        ? `${token.eventIds.length} selected events`
                        : "All events"}
                    </p>
                    <small>
                      Created {new Date(token.createdAt).toLocaleString()}
                      {stats
                        ? ` · ${stats.requests} requests and ${stats.failures} failures in 30 days`
                        : " · No requests yet"}
                      {token.lastUsedAt
                        ? ` · Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                        : ""}
                      {token.revokedAt
                        ? ` · Revoked ${new Date(token.revokedAt).toLocaleString()}`
                        : ""}
                    </small>
                    <details>
                      <summary>Edit token settings and access</summary>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          void run(
                            () =>
                              api(
                                `/api/developer/organizations/${organizationId}/tokens/${token.id}`,
                                {
                                  method: "PATCH",
                                  body: JSON.stringify({
                                    name: form.get("name"),
                                    scopes: form.getAll("scopes"),
                                    eventIds: form.getAll("eventIds"),
                                    hidePii: form.get("hidePii") === "on",
                                    expiresAt: form.get("expiresAt")
                                      ? new Date(
                                          String(form.get("expiresAt")),
                                        ).toISOString()
                                      : null,
                                  }),
                                },
                              ),
                            `${token.name} access updated.`,
                          );
                        }}
                        className="developer-form compact"
                      >
                        <label>
                          Descriptive name
                          <input
                            name="name"
                            defaultValue={token.name}
                            required
                          />
                        </label>
                        <label>
                          Expiration{" "}
                          <small>Leave empty for no expiration.</small>
                          <input
                            name="expiresAt"
                            type="datetime-local"
                            defaultValue={
                              token.expiresAt
                                ? localDateTimeInput(token.expiresAt)
                                : ""
                            }
                          />
                        </label>
                        <fieldset>
                          <legend>Scopes</legend>
                          {data.scopes.map((scope) => (
                            <label className="check-row" key={scope}>
                              <input
                                type="checkbox"
                                name="scopes"
                                value={scope}
                                defaultChecked={token.scopes.includes(scope)}
                              />
                              <span>{scope}</span>
                            </label>
                          ))}
                        </fieldset>
                        <fieldset>
                          <legend>Events</legend>
                          {events.map((item) => (
                            <label className="check-row" key={item.id}>
                              <input
                                type="checkbox"
                                name="eventIds"
                                value={item.id}
                                defaultChecked={token.eventIds.includes(
                                  item.id,
                                )}
                              />
                              <span>{item.name}</span>
                            </label>
                          ))}
                        </fieldset>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            name="hidePii"
                            defaultChecked={token.hidePii}
                          />
                          <span>Hide PII</span>
                        </label>
                        <button className="button button-small">
                          Save token access
                        </button>
                      </form>
                    </details>
                    {!token.revokedAt && (
                      <div className="record-actions">
                        <button
                          className="button button-small button-ghost"
                          onClick={() =>
                            void run(async () => {
                              const result = await api<{ value: string }>(
                                `/api/developer/organizations/${organizationId}/tokens/${token.id}/rotate`,
                                { method: "POST" },
                              );
                              setSecret({
                                label: `${token.name} rotated token`,
                                value: result.value,
                              });
                            }, `${token.name} rotated. The previous token stopped working immediately.`)
                          }
                        >
                          <RotateCcw size={14} /> Rotate
                        </button>
                        <button
                          className="button button-small button-danger"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke ${token.name}? Requests using it will fail immediately.`,
                              )
                            )
                              void run(
                                () =>
                                  api(
                                    `/api/developer/organizations/${organizationId}/tokens/${token.id}`,
                                    { method: "DELETE" },
                                  ),
                                `${token.name} revoked.`,
                              );
                          }}
                        >
                          <Trash2 size={14} /> Revoke
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
              {!data.tokens.length && (
                <div className="empty-panel">
                  <p>
                    No API tokens yet. Create a read-only token to connect your
                    first trusted system.
                  </p>
                </div>
              )}
            </section>
          </div>
        ) : tab === "webhooks" ? (
          <div className="developer-settings-grid">
            <section className="panel-card">
              <h2>Create webhook</h2>
              <p>
                ProgramLoom signs every queued delivery and preserves a
                retryable delivery history.
              </p>
              <form className="developer-form" onSubmit={createWebhook}>
                <label>
                  Name
                  <input name="name" required placeholder="Data warehouse" />
                </label>
                <label>
                  HTTPS endpoint
                  <input
                    name="endpointUrl"
                    type="url"
                    required
                    placeholder="https://example.com/programloom"
                  />
                </label>
                <label>
                  Entity filters{" "}
                  <small>
                    Comma-separated; empty sends all authorized entity types.
                  </small>
                  <input
                    name="entityTypes"
                    placeholder="submission, agenda_item"
                  />
                </label>
                <fieldset>
                  <legend>Event filters</legend>
                  {events.map((item) => (
                    <label className="check-row" key={item.id}>
                      <input type="checkbox" name="eventIds" value={item.id} />
                      <span>{item.name}</span>
                    </label>
                  ))}
                </fieldset>
                <button className="button">Create webhook</button>
              </form>
            </section>
            <section className="panel-card developer-records">
              <h2>Webhook subscriptions</h2>
              {data.webhooks.map((item) => (
                <article key={item.id}>
                  <header>
                    <div>
                      <strong>{item.name}</strong>
                      <code>{item.endpointUrl}</code>
                    </div>
                    <span>{item.enabled ? "Active" : "Disabled"}</span>
                  </header>
                  <p>
                    {item.deliveryCount} deliveries · {item.failedCount} failed
                    ·{" "}
                    {item.eventIds.length
                      ? `${item.eventIds.length} events`
                      : "all events"}
                  </p>
                  <details>
                    <summary>Edit subscription and filters</summary>
                    <form
                      className="developer-form compact"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void run(
                          () =>
                            api(
                              `/api/developer/organizations/${organizationId}/webhooks/${item.id}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  name: form.get("name"),
                                  endpointUrl: form.get("endpointUrl"),
                                  entityTypes: String(
                                    form.get("entityTypes") ?? "",
                                  )
                                    .split(",")
                                    .map((value) => value.trim())
                                    .filter(Boolean),
                                  eventIds: form.getAll("eventIds"),
                                }),
                              },
                            ),
                          `${item.name} subscription updated. New deliveries use these filters.`,
                        );
                      }}
                    >
                      <label>
                        Name
                        <input name="name" defaultValue={item.name} required />
                      </label>
                      <label>
                        HTTPS endpoint
                        <input
                          name="endpointUrl"
                          type="url"
                          defaultValue={item.endpointUrl}
                          required
                        />
                      </label>
                      <label>
                        Entity filters
                        <input
                          name="entityTypes"
                          defaultValue={item.entityTypes.join(", ")}
                        />
                      </label>
                      <fieldset>
                        <legend>Event filters</legend>
                        {events.map((eventRecord) => (
                          <label className="check-row" key={eventRecord.id}>
                            <input
                              type="checkbox"
                              name="eventIds"
                              value={eventRecord.id}
                              defaultChecked={item.eventIds.includes(
                                eventRecord.id,
                              )}
                            />
                            <span>{eventRecord.name}</span>
                          </label>
                        ))}
                      </fieldset>
                      <button className="button button-small">
                        Save webhook settings
                      </button>
                    </form>
                  </details>
                  <div className="record-actions">
                    <button
                      className="button button-small button-ghost"
                      onClick={() =>
                        void run(
                          () =>
                            api(
                              `/api/developer/organizations/${organizationId}/webhooks/${item.id}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  enabled: !item.enabled,
                                }),
                              },
                            ),
                          `${item.name} ${item.enabled ? "disabled" : "enabled"}.`,
                        )
                      }
                    >
                      {item.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="button button-small button-ghost"
                      onClick={() =>
                        void run(async () => {
                          const result = await api<{ secret: string }>(
                            `/api/developer/organizations/${organizationId}/webhooks/${item.id}/rotate`,
                            { method: "POST" },
                          );
                          setSecret({
                            label: `${item.name} rotated signing secret`,
                            value: result.secret,
                          });
                        }, `${item.name} signing secret rotated.`)
                      }
                    >
                      <RefreshCw size={14} /> Rotate secret
                    </button>
                    <button
                      className="button button-small button-ghost"
                      onClick={() => void showDeliveries(item)}
                    >
                      View delivery history
                    </button>
                  </div>
                </article>
              ))}
              {!data.webhooks.length && (
                <div className="empty-panel">
                  <p>
                    No webhook subscriptions. Create one to receive durable
                    program changes.
                  </p>
                </div>
              )}
              {selectedWebhook && (
                <section className="developer-delivery-history">
                  <header>
                    <div>
                      <h3>{selectedWebhook.name} delivery history</h3>
                      <p>
                        Provider responses, bounded retries, and replay
                        controls.
                      </p>
                    </div>
                    <button
                      className="button button-small button-ghost"
                      onClick={() => {
                        setSelectedWebhook(undefined);
                        setDeliveries([]);
                      }}
                    >
                      Close delivery history
                    </button>
                  </header>
                  {deliveries.map((delivery) => (
                    <article key={delivery.id}>
                      <div>
                        <strong>{delivery.action}</strong>
                        <code>
                          {delivery.entityType} · {delivery.entityId}
                        </code>
                      </div>
                      <span>{delivery.status}</span>
                      <p>
                        {delivery.attempts} attempts
                        {delivery.responseStatus
                          ? ` · HTTP ${delivery.responseStatus}`
                          : ""}
                        {delivery.failureReason
                          ? ` · ${delivery.failureReason}`
                          : ""}
                      </p>
                      {["failed", "retrying"].includes(delivery.status) && (
                        <button
                          className="button button-small"
                          onClick={() =>
                            void run(
                              () =>
                                api(
                                  `/api/developer/organizations/${organizationId}/webhook-deliveries/${delivery.id}/retry`,
                                  { method: "POST" },
                                ).then(() => showDeliveries(selectedWebhook)),
                              `${delivery.action} queued for a safe retry.`,
                            )
                          }
                        >
                          Retry delivery
                        </button>
                      )}
                    </article>
                  ))}
                  {!deliveries.length && (
                    <div className="empty-panel">
                      No deliveries yet. Program changes will appear here after
                      they are durably queued.
                    </div>
                  )}
                </section>
              )}
            </section>
          </div>
        ) : (
          <div className="developer-settings-grid">
            <section className="panel-card">
              <h2>Create OAuth 2.1 client</h2>
              <p>
                External apps authorize with PKCE S256. Public clients need no
                secret; confidential clients receive one once.
              </p>
              <form className="developer-form" onSubmit={createOAuthClient}>
                <label>
                  Name
                  <input
                    name="name"
                    required
                    placeholder="Partner scheduling app"
                  />
                </label>
                <label>
                  Redirect URIs
                  <textarea
                    name="redirectUris"
                    rows={4}
                    required
                    placeholder="https://example.com/oauth/callback"
                  />
                </label>
                <fieldset>
                  <legend>Maximum scopes</legend>
                  {data.scopes.map((scope) => (
                    <label className="check-row" key={scope}>
                      <input
                        type="checkbox"
                        name="scopes"
                        value={scope}
                        defaultChecked={scope.startsWith("read:")}
                      />
                      <span>{scope}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="check-row">
                  <input type="checkbox" name="confidential" />
                  <span>
                    <strong>Confidential client</strong>
                    <small>
                      Only for a server that can protect a client secret.
                    </small>
                  </span>
                </label>
                <button className="button">Create OAuth client</button>
              </form>
            </section>
            <section className="panel-card developer-records">
              <h2>OAuth clients</h2>
              {data.oauthClients.map((client) => (
                <article key={client.id}>
                  <header>
                    <div>
                      <strong>{client.name}</strong>
                      <code>{client.id}</code>
                    </div>
                    <span>{client.revokedAt ? "Revoked" : "Active"}</span>
                  </header>
                  <p>
                    {client.confidential ? "Confidential" : "Public PKCE"} ·{" "}
                    {client.scopes.length} scopes
                  </p>
                  <small>{client.redirectUris.join(", ")}</small>
                  {!client.revokedAt && (
                    <>
                      <details>
                        <summary>Edit OAuth client</summary>
                        <form
                          className="developer-form compact"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            void run(
                              () =>
                                api(
                                  `/api/developer/organizations/${organizationId}/oauth-clients/${client.id}`,
                                  {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      name: form.get("name"),
                                      redirectUris: String(
                                        form.get("redirectUris") ?? "",
                                      )
                                        .split(/\r?\n/)
                                        .map((value) => value.trim())
                                        .filter(Boolean),
                                      scopes: form.getAll("scopes"),
                                    }),
                                  },
                                ),
                              `${client.name} OAuth settings updated.`,
                            );
                          }}
                        >
                          <label>
                            Name
                            <input
                              name="name"
                              defaultValue={client.name}
                              required
                            />
                          </label>
                          <label>
                            Redirect URIs
                            <textarea
                              name="redirectUris"
                              rows={3}
                              defaultValue={client.redirectUris.join("\n")}
                              required
                            />
                          </label>
                          <fieldset>
                            <legend>Maximum scopes</legend>
                            {data.scopes.map((scope) => (
                              <label className="check-row" key={scope}>
                                <input
                                  type="checkbox"
                                  name="scopes"
                                  value={scope}
                                  defaultChecked={client.scopes.includes(scope)}
                                />
                                <span>{scope}</span>
                              </label>
                            ))}
                          </fieldset>
                          <button className="button button-small">
                            Save OAuth client
                          </button>
                        </form>
                      </details>
                      <div className="record-actions">
                        {client.confidential && (
                          <button
                            className="button button-small button-ghost"
                            onClick={() =>
                              void run(async () => {
                                const result = await api<{
                                  clientSecret: string;
                                }>(
                                  `/api/developer/organizations/${organizationId}/oauth-clients/${client.id}/rotate-secret`,
                                  { method: "POST" },
                                );
                                setSecret({
                                  label: `${client.name} rotated client secret`,
                                  value: result.clientSecret,
                                });
                              }, `${client.name} client secret rotated; the previous secret stopped working immediately.`)
                            }
                          >
                            Rotate client secret
                          </button>
                        )}
                        <button
                          className="button button-small button-danger"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Revoke ${client.name}? Its access and refresh tokens will stop working immediately.`,
                              )
                            )
                              return;
                            void run(
                              () =>
                                api(
                                  `/api/developer/organizations/${organizationId}/oauth-clients/${client.id}`,
                                  { method: "DELETE" },
                                ),
                              `${client.name} revoked with all issued access.`,
                            );
                          }}
                        >
                          <Trash2 size={14} /> Revoke OAuth client
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
              {!data.oauthClients.length && (
                <div className="empty-panel">
                  <p>
                    No OAuth clients. Create one when an external application
                    needs user-authorized access.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
