import { ArrowRight, CalendarRange, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type PublicForm = {
  id: string;
  name: string;
  description: string | null;
  eventName: string;
  eventStartsAt: string;
  organizationName: string;
  closesAt: string | null;
  availability: "open" | "upcoming" | "closed";
  url: string;
};

export function PublicCfpDirectory() {
  const [state, setState] = useState<{
    loading: boolean;
    forms: PublicForm[];
    error?: string;
  }>({ loading: true, forms: [] });

  useEffect(() => {
    fetch("/api/public/cfp")
      .then(async (response) => {
        const result = (await response.json()) as {
          forms?: PublicForm[];
          error?: { message?: string };
        };
        if (!response.ok)
          throw new Error(
            result.error?.message ?? "Calls could not be loaded.",
          );
        setState({ loading: false, forms: result.forms ?? [] });
      })
      .catch((error) =>
        setState({
          loading: false,
          forms: [],
          error:
            error instanceof Error
              ? error.message
              : "Calls could not be loaded.",
        }),
      );
  }, []);

  return (
    <main id="main-content" className="cfp-directory">
      <header>
        <Link to="/" className="wordmark" aria-label="ProgramLoom home">
          <span aria-hidden="true" className="mark">
            PL
          </span>
          ProgramLoom
        </Link>
        <p className="kicker">Open calls</p>
        <h1>Share the work you want to bring to the room.</h1>
        <p>
          Browse public calls for proposals. Submitting does not require a
          ProgramLoom account.
        </p>
      </header>

      {state.loading && <div className="inline-empty">Loading open calls…</div>}
      {state.error && (
        <div className="form-status form-status-error" role="alert">
          {state.error}
        </div>
      )}
      {!state.loading && !state.error && !state.forms.length && (
        <div className="cfp-directory-empty">
          <FileText size={28} />
          <h2>No public calls are open right now.</h2>
          <p>Check back soon for new opportunities.</p>
        </div>
      )}
      <section
        className="cfp-directory-grid"
        aria-label="Public calls for proposals"
      >
        {state.forms.map((form) => (
          <article key={form.id}>
            <div className="cfp-directory-card-heading">
              <span
                className={`availability availability-${form.availability}`}
              >
                {form.availability}
              </span>
              <small>{form.organizationName}</small>
            </div>
            <h2>{form.eventName}</h2>
            <h3>{form.name}</h3>
            <p>
              {form.description ?? "Share your proposal with the program team."}
            </p>
            <div className="cfp-directory-meta">
              <CalendarRange size={15} />
              {form.closesAt
                ? `Closes ${new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                  }).format(new Date(form.closesAt))}`
                : "Rolling submissions"}
            </div>
            <Link className="button" to={form.url}>
              {form.availability === "open" ? "Submit a proposal" : "View call"}
              <ArrowRight size={16} />
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
