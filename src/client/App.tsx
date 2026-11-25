import { useEffect, useState } from "react";
import { api, setUser, type ProjectRow } from "./api";
import { PlanPage } from "./PlanPage";

const PEOPLE = ["Ada", "Tunde", "Chioma"];

function readUser(): string {
  try {
    return localStorage.getItem("scopeproof.user") || "Ada";
  } catch {
    return "Ada";
  }
}

function useHashRoute(): number | null {
  const parse = () => {
    const m = location.hash.match(/^#\/plan\/(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const [id, setId] = useState(parse);
  useEffect(() => {
    const on = () => setId(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return id;
}

export function App() {
  const [user, setUserState] = useState(readUser);
  const planId = useHashRoute();
  setUser(user);

  const pick = (name: string) => {
    setUserState(name);
    setUser(name);
    try {
      localStorage.setItem("scopeproof.user", name);
    } catch {
      /* private mode: the choice just lasts for this tab */
    }
  };

  return (
    <div className="shell">
      <header className="top">
        <a className="mark" href="#/">
          <span className="tick" aria-hidden>✓</span> Scopeproof
        </a>
        <div className="who">
          <span className="label">You are</span>
          <div className="people" role="radiogroup" aria-label="Who you are">
            {PEOPLE.map((p) => (
              <button key={p} role="radio" aria-checked={p === user} className={p === user ? "on" : ""} onClick={() => pick(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </header>
      {planId ? <PlanPage key={`${planId}-${user}`} id={planId} user={user} /> : <Home user={user} />}
      <footer className="foot">
        A model drafts. Shared rules check. A second person signs off. <a href="https://github.com/barnascript/scopeproof">Code on GitHub ↗</a>
      </footer>
    </div>
  );
}

function Home({ user }: { user: string }) {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.projects().then(setRows, (e) => setError(e.message));
  }, []);

  const useSample = async () => {
    const s = await api.sample();
    setName(s.name);
    setBrief(s.brief);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const v = await api.create(name, brief);
      location.hash = `#/plan/${v.project.id}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <section className="intro">
        <h1>
          From brief to plan, <em>with proof.</em>
        </h1>
        <p>
          Paste what the client asked for. A model (or a plain rule drafter) breaks it into stories with estimates. Then the same checks run in your
          browser and on the server: every story must point to a line in the brief, every brief line needs a story or a reason it was left out,
          criteria must be testable, and the dependencies cannot loop. Nobody can approve their own work, and a locked plan cannot change.
        </p>
      </section>

      <div className="home-grid">
        <section className="card">
          <h2>Plans</h2>
          {!rows && !error && <p className="muted">Loading…</p>}
          {rows?.length === 0 && <p className="muted">No plans yet.</p>}
          <ul className="plans">
            {rows?.map((r) => (
              <li key={r.id}>
                <a href={`#/plan/${r.id}`}>
                  <span className="pname">{r.name}</span>
                  <span className={`pill ${r.status}`}>{r.status === "locked" ? "Locked" : `${r.approved}/${r.stories} approved`}</span>
                </a>
                <span className="muted small">
                  Started by {r.created_by}, {new Date(r.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <form className="card" onSubmit={create}>
          <h2>New plan</h2>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="Clinic booking MVP" />
          </label>
          <label>
            Brief <span className="muted small">one requirement per line works best</span>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={12} maxLength={6000} required />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Creating…" : `Create as ${user}`}
            </button>
            <button type="button" className="ghost" onClick={useSample}>
              Use the sample brief
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
