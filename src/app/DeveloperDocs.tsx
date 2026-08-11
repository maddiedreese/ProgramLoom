import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  KeyRound,
  Webhook,
} from "lucide-react";

const scopes = [
  "read:events",
  "read:sessions",
  "read:speakers",
  "read:contacts",
  "read:submissions",
  "read:agenda",
  "read:content",
  "write:sessions",
  "write:contacts",
  "write:events",
  "write:metadata",
  "write:fields",
  "write:agenda",
];
const scopeDescriptions: Record<string, string> = {
  "read:events": "List and retrieve allowed events.",
  "read:sessions": "Read accepted program sessions.",
  "read:speakers": "Read event speaker profiles.",
  "read:contacts": "Read CRM contacts with token-level PII controls.",
  "read:submissions": "Read CFP submissions and decision state.",
  "read:agenda": "Read published agenda, or draft agenda with write access.",
  "read:content": "List session files and request short-lived downloads.",
  "write:sessions":
    "Create, update, soft-delete, restore, and bulk-change sessions.",
  "write:contacts": "Create, update, soft-delete, and restore contacts.",
  "write:events": "Create and version-update events.",
  "write:metadata": "Manage rooms, tracks, tags, and formats.",
  "write:fields": "Update session custom-field values.",
  "write:agenda": "Place and move sessions with conflict and calendar checks.",
};

export function DeveloperDocs() {
  return (
    <div className="developer-docs">
      <header>
        <a className="wordmark" href="/">
          <span className="mark" aria-hidden="true">
            PL
          </span>{" "}
          ProgramLoom
        </a>
        <nav aria-label="Developer documentation">
          <a href="#start">Quickstart</a>
          <a href="#auth">Authentication</a>
          <a href="#webhooks">Webhooks</a>
          <a href="/api/v1/openapi.json">OpenAPI</a>
          <a className="button button-small" href="/app/settings">
            Manage API access
          </a>
        </nav>
      </header>
      <main id="main-content">
        <section className="docs-hero">
          <p className="kicker">ProgramLoom Developer Platform · v1</p>
          <h1>Connect your program without exposing its private operations.</h1>
          <p>
            Use stable REST resources, event-restricted tokens, signed webhooks,
            OAuth 2.1 PKCE, a remote MCP server, or the bounded read-only query
            API. Every request is tenant-scoped, rate-limited, correlated, and
            auditable.
          </p>
          <div>
            <a className="button button-large" href="#start">
              Make your first request <ArrowRight size={17} />
            </a>
            <a
              className="button button-large button-ghost"
              href="/api/v1/collection.json"
            >
              Download API collection
            </a>
          </div>
        </section>
        <section className="docs-layout">
          <aside>
            <strong>On this page</strong>
            <a href="#start">Quickstart</a>
            <a href="#auth">Authentication and scopes</a>
            <a href="#pagination">Pagination and errors</a>
            <a href="#write-safety">Write safety</a>
            <a href="#webhooks">Webhook verification</a>
            <a href="#oauth">OAuth, MCP, and query</a>
            <a href="#versioning">Versioning</a>
          </aside>
          <article>
            <section id="start">
              <Code2 size={24} />
              <h2>Quickstart</h2>
              <ol>
                <li>Open Workspace settings → API tokens.</li>
                <li>
                  Create a descriptive token. Keep “Hide PII” enabled and select
                  only the events and scopes your integration needs.
                </li>
                <li>Copy the token once into your secret manager.</li>
                <li>
                  Send it in the <code>x-access-token</code> header—never in a
                  URL.
                </li>
              </ol>
              <pre>
                <code>{`curl 'https://app.programloom.com/api/v1/events?limit=25' \\
  -H "x-access-token: $PROGRAMLOOM_TOKEN"`}</code>
              </pre>
              <h3>JavaScript</h3>
              <pre>
                <code>{`const response = await fetch(
  "https://app.programloom.com/api/v1/sessions?search=engineering",
  { headers: { "x-access-token": process.env.PROGRAMLOOM_TOKEN } },
);
const { data, pagination, requestId } = await response.json();`}</code>
              </pre>
              <h3>Python</h3>
              <pre>
                <code>{`response = requests.get(
    "https://app.programloom.com/api/v1/events",
    headers={"x-access-token": os.environ["PROGRAMLOOM_TOKEN"]},
    params={"limit": 25},
)
response.raise_for_status()`}</code>
              </pre>
            </section>
            <section id="auth">
              <KeyRound size={24} />
              <h2>Authentication and least privilege</h2>
              <p>
                Organization tokens are random, stored only as hashes, shown
                once, immediately revocable, and optionally expiring. Event
                restrictions are enforced in database queries. “Hide PII” masks
                contact and speaker email plus submission and contact custom
                fields by default.
              </p>
              <div className="scope-grid">
                {scopes.map((scope) => (
                  <div key={scope}>
                    <code>{scope}</code>
                    <span>{scopeDescriptions[scope]}</span>
                  </div>
                ))}
              </div>
              <p>
                Token responses show creation, last use, revocation, and 30-day
                request/failure counts. Rotate a token to invalidate its old
                value immediately.
              </p>
            </section>
            <section id="pagination">
              <h2>Pagination, rate limits, and errors</h2>
              <p>
                Every collection accepts <code>page</code> and{" "}
                <code>limit</code>. The default is 25 and the maximum is 100.
                Responses include <code>pagination.hasMore</code>.
              </p>
              <p>
                The API returns <code>X-RateLimit-Limit</code>,{" "}
                <code>X-RateLimit-Remaining</code>, and{" "}
                <code>X-RateLimit-Reset</code>. A one-minute limit breach
                returns HTTP 429.
              </p>
              <pre>
                <code>{`{
  "error": {
    "code": "version_conflict",
    "message": "The record changed. Fetch it again before updating."
  },
  "requestId": "correlation-id"
}`}</code>
              </pre>
            </section>
            <section id="write-safety">
              <h2>Safe writes</h2>
              <ul>
                <li>
                  <Check size={15} /> Creates, deletes, restores, and bulk
                  mutations require <code>Idempotency-Key</code>.
                </li>
                <li>
                  <Check size={15} /> Updates require the current ETag in{" "}
                  <code>If-Match</code>.
                </li>
                <li>
                  <Check size={15} /> Session and contact deletion is
                  recoverable.
                </li>
                <li>
                  <Check size={15} /> Bulk session operations are bounded to 100
                  records.
                </li>
                <li>
                  <Check size={15} /> Agenda writes check room and speaker
                  conflicts before committing and maintain calendar identity.
                </li>
              </ul>
            </section>
            <section id="webhooks">
              <Webhook size={24} />
              <h2>Signed, replayable webhooks</h2>
              <p>
                Subscriptions can filter events and entity types. ProgramLoom
                queues each audit-backed change, retries with bounded
                exponential backoff, and gives every delivery a stable ID. The
                payload includes an entity-specific <code>sequence</code> and
                immutable <code>auditEventId</code>; consumers should ignore a
                lower sequence after applying a newer one.
              </p>
              <p>
                Read the raw body. Compute HMAC-SHA256 over{" "}
                <code>{`{timestamp}.{rawBody}`}</code> with the one-time signing
                secret. Compare the base64url result to the value after{" "}
                <code>v1=</code> in <code>x-programloom-signature</code>. Reject
                stale timestamps and store <code>x-programloom-delivery</code>{" "}
                to deduplicate replays.
              </p>
              <pre>
                <code>{`const expected = base64url(
  hmacSha256(secret, timestamp + "." + rawBody),
);
timingSafeEqual("v1=" + expected, signature);`}</code>
              </pre>
            </section>
            <section id="oauth">
              <h2>OAuth 2.1, MCP, and structured query</h2>
              <p>
                OAuth clients use authorization code with PKCE S256. Access
                tokens expire after one hour; rotating refresh tokens expire
                after 30 days. Public clients do not need a client secret.
              </p>
              <p>
                The remote MCP JSON-RPC endpoint is{" "}
                <code>POST /api/v1/mcp</code> and uses the same token, scopes,
                event restrictions, and PII controls. The read-only structured
                query endpoint is <code>POST /api/v1/query</code>; inspect{" "}
                <code>GET /api/v1/query/schema</code> before building a query.
                Query fields and filters come from an allowlist—raw SQL and
                unrestricted natural-language execution are not accepted.
              </p>
            </section>
            <section id="versioning">
              <h2>Versioning and deprecation</h2>
              <p>
                Breaking changes require a new major URL version. Deprecated v1
                behavior receives at least 180 days’ notice in the{" "}
                <a href="/api/v1/changelog">changelog</a>. The machine-readable
                contract is the{" "}
                <a href="/api/v1/openapi.json">OpenAPI document</a>.
              </p>
              <p>
                For a runnable clean-checkout example, see{" "}
                <code>examples/developer-api/</code> in the repository.
              </p>
            </section>
          </article>
        </section>
      </main>
      <footer>
        <a href="/">
          <ArrowLeft size={15} /> ProgramLoom home
        </a>
        <a href="/api/v1/openapi.json">OpenAPI 3.1</a>
        <a href="/api/v1/changelog">Changelog</a>
      </footer>
    </div>
  );
}
