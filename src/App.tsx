import { ArrowRight, CalendarRange, Check, GalleryVerticalEnd, Sparkles, UsersRound } from "lucide-react";
import { Link, Route, Routes } from "react-router-dom";

const capabilities = [
  { icon: GalleryVerticalEnd, title: "Shape the program", body: "Collect proposals with conditional forms, route reviews, and make decisions with confidence." },
  { icon: UsersRound, title: "Take care of speakers", body: "One calm portal for profiles, tasks, travel, files, feedback, and every deadline." },
  { icon: CalendarRange, title: "Publish without collisions", body: "Build a multi-track schedule, catch conflicts early, and publish live, embeddable views." },
];

function Wordmark() {
  return <span className="wordmark"><span aria-hidden="true" className="mark">PL</span>ProgramLoom</span>;
}

function MarketingPage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link to="/" className="brand" aria-label="ProgramLoom home"><Wordmark /></Link>
        <nav aria-label="Primary navigation">
          <a href="#product">Product</a>
          <a href="#principles">Why ProgramLoom</a>
          <Link className="button button-small button-ghost" to="/login">Sign in</Link>
          <Link className="button button-small" to="/register">Start free</Link>
        </nav>
      </header>
      <main id="main-content">
        <section className="hero">
          <div className="eyebrow"><Sparkles size={15} /> The program workspace that keeps its promises</div>
          <h1>Weave every moving part into one remarkable program.</h1>
          <p className="hero-copy">Proposals, reviews, speakers, content, schedules, and public pages—connected from the first submission to showtime.</p>
          <div className="hero-actions">
            <Link className="button button-large" to="/register">Build your first event <ArrowRight size={18} /></Link>
            <a className="text-link" href="https://github.com/maddiedreese/SaaS">Open-source on GitHub</a>
          </div>
          <div className="proof-row" aria-label="Product principles">
            <span><Check size={16} /> Free to start</span>
            <span><Check size={16} /> No attendee data resale</span>
            <span><Check size={16} /> AGPL open source</span>
          </div>
        </section>
        <section id="product" className="capabilities" aria-labelledby="capabilities-title">
          <div className="section-heading">
            <p className="kicker">One continuous workflow</p>
            <h2 id="capabilities-title">Less chasing. More programming.</h2>
          </div>
          <div className="card-grid">
            {capabilities.map(({ icon: Icon, title, body }, index) => (
              <article className="capability-card" key={title}>
                <div className="card-number">0{index + 1}</div>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="principles" className="manifesto">
          <p className="kicker">Designed for the people doing the work</p>
          <blockquote>“A program tool should reduce uncertainty, not move it into another spreadsheet.”</blockquote>
          <p>ProgramLoom keeps every decision, handoff, and public update connected—while Airtable remains available to teams that work best there.</p>
        </section>
      </main>
      <footer><Wordmark /><span>Built in the open for event teams.</span></footer>
    </div>
  );
}

function EntryPage({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  return (
    <main id="main-content" className="entry-layout">
      <section className="entry-aside">
        <Link to="/" className="brand"><Wordmark /></Link>
        <p className="kicker">Your program, in rhythm</p>
        <h1>{registering ? "Make the busy work feel beautifully quiet." : "Welcome back to the loom."}</h1>
        <p>ProgramLoom keeps organizers, reviewers, and speakers moving together.</p>
      </section>
      <section className="entry-panel" aria-labelledby="entry-title">
        <div className="entry-card">
          <p className="kicker">{registering ? "Create an organizer account" : "Sign in securely"}</p>
          <h2 id="entry-title">{registering ? "Start with your work email" : "Continue to ProgramLoom"}</h2>
          <form>
            {registering && <label>Full name<input autoComplete="name" name="name" required /></label>}
            <label>Email address<input autoComplete="email" name="email" type="email" required /></label>
            <button className="button button-large" type="submit">Email me a secure link <ArrowRight size={18} /></button>
          </form>
          <p className="form-note">Passwordless sign-in. Links expire after 15 minutes.</p>
          <p>{registering ? "Already have an account?" : "New to ProgramLoom?"} <Link className="text-link" to={registering ? "/login" : "/register"}>{registering ? "Sign in" : "Start free"}</Link></p>
        </div>
      </section>
    </main>
  );
}

export function App() {
  return <Routes><Route path="/" element={<MarketingPage />} /><Route path="/login" element={<EntryPage mode="login" />} /><Route path="/register" element={<EntryPage mode="register" />} /><Route path="*" element={<MarketingPage />} /></Routes>;
}
