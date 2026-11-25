import { useCallback, useEffect, useRef, useState } from "react";
import { checkPlan, type Finding } from "../shared/checks";
import { briefLines, type DraftStory, type PlanEvent, type Story } from "../shared/plan";
import { api, ApiError, type DrafterInfo, type PlanView } from "./api";

const SOURCE_LABEL: Record<Story["source"], string> = {
  model: "model draft",
  rules: "rule draft",
  sample: "sample draft",
  person: "written by a person",
};

export function PlanPage({ id, user }: { id: number; user: string }) {
  const [v, setV] = useState<PlanView | null>(null);
  const [drafters, setDrafters] = useState<DrafterInfo[]>([]);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string; list?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const editingRef = useRef(false);
  editingRef.current = !!editing || adding;

  const load = useCallback(() => api.plan(id).then(setV), [id]);

  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", text: e.message }));
    api.drafters().then(setDrafters, () => {});
  }, [load]);

  // Someone else may be working on the same plan in another tab. Pick up
  // their changes, but never while this person is halfway through an edit.
  useEffect(() => {
    const t = setInterval(async () => {
      if (editingRef.current || document.hidden) return;
      try {
        const next = await api.plan(id);
        setV((cur) => (cur && next.project.version !== cur.project.version ? next : cur));
      } catch {
        /* the next tick will try again */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [id]);

  const run = async (fn: (version: number) => Promise<PlanView>, ok?: string) => {
    if (!v) return false;
    setBusy(true);
    setNotice(null);
    try {
      setV(await fn(v.project.version));
      if (ok) setNotice({ kind: "info", text: ok });
      return true;
    } catch (e) {
      const err = e as ApiError;
      const findings = (err.body?.findings as Finding[] | undefined)?.map((f) => `${f.story ?? `Line ${f.line}`}: ${f.message}`);
      const waiting = err.body?.waiting as string[] | undefined;
      const list = [...(waiting?.length ? [`Still waiting for approval: ${waiting.join(", ")}`] : []), ...(findings ?? [])];
      setNotice({ kind: "error", text: err.message, list });
      if (err.status === 409 && err.body?.version) await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!v) {
    return <main className="plan">{notice ? <p className="error">{notice.text}</p> : <p className="muted">Loading…</p>}</main>;
  }

  const { project: p, stories, check } = v;
  const locked = p.status === "locked";
  const blocks = check.findings.filter((f) => f.severity === "block");
  const warns = check.findings.filter((f) => f.severity === "warn");
  const waiting = stories.filter((s) => s.status !== "approved");
  const approvedAny = stories.some((s) => s.status === "approved");
  const lockReason =
    stories.length === 0
      ? "Draft some stories first."
      : waiting.length
        ? `${waiting.length} ${waiting.length === 1 ? "story needs" : "stories need"} approval.`
        : blocks.length
          ? `${blocks.length} ${blocks.length === 1 ? "problem" : "problems"} left.`
          : "";

  return (
    <main className="plan">
      <a className="back" href="#/">
        ← All plans
      </a>
      <section className="plan-head">
        <div>
          <h1>{p.name}</h1>
          <p className="muted">
            Started by {p.created_by}.{" "}
            {locked ? (
              <strong className="locked-note">
                Locked by {p.locked_by} on {new Date(p.locked_at!).toLocaleString()}. Read only.
              </strong>
            ) : (
              "Open for changes."
            )}
          </p>
        </div>
        <div className="stats">
          <Stat n={stories.length} label="stories" />
          <Stat n={`${stories.length - waiting.length}/${stories.length}`} label="approved" />
          <Stat n={check.totalHours} label="hours" />
          <Stat
            n={check.criticalPath.keys.length ? check.criticalPath.hours : "–"}
            label="hours on the longest chain"
            title={check.criticalPath.keys.length ? check.criticalPath.keys.join(" → ") : "Fix the dependency loop to see this."}
          />
          <Stat n={blocks.length} label="must fix" tone={blocks.length ? "bad" : "good"} />
          <Stat n={warns.length} label="worth a look" tone={warns.length ? "warn" : "good"} />
        </div>
      </section>

      {!locked && (
        <section className="actions card">
          <DraftControls drafters={drafters} busy={busy} disabledReason={approvedAny ? "Reopen approved stories before you redraft." : ""} onDraft={(name) => run((ver) => api.draft(p.id, ver, name), "New draft loaded. Check the findings, fix, then ask someone to approve.")} />
          <div className="lock">
            <button className="primary" disabled={busy || !!lockReason} onClick={() => run((ver) => api.lock(p.id, ver), "Plan locked.")}>
              Lock plan
            </button>
            <span className="muted small">{lockReason || "Everything is approved and checked."}</span>
          </div>
        </section>
      )}

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <p>{notice.text}</p>
          {notice.list && notice.list.length > 0 && (
            <ul>
              {notice.list.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <button className="x" aria-label="Close" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      <div className="plan-grid">
        <BriefPanel view={v} locked={locked} busy={busy} onScope={(line, out, reason) => run((ver) => api.scope(p.id, ver, line, out, reason))} />

        <section className="stories">
          <div className="stories-head">
            <h2>Stories</h2>
            {!locked && !adding && (
              <button className="ghost" onClick={() => setAdding(true)}>
                + Add a story
              </button>
            )}
          </div>
          {stories.length === 0 && !adding && <p className="muted empty">No stories yet. Pick a drafter above, or add one by hand.</p>}
          {adding && (
            <StoryEditor
              brief={p.brief}
              outOfScope={p.out_of_scope.map((o) => o.line)}
              others={stories}
              initial={{ key: "NEW", title: "", description: "", acceptance: [], estimate_hours: 4, depends_on: [], brief_lines: [] }}
              busy={busy}
              onCancel={() => setAdding(false)}
              onSave={async ({ key: _k, ...s }) => {
                if (await run((ver) => api.add(p.id, ver, s))) setAdding(false);
              }}
            />
          )}
          {stories.map((s) =>
            editing === s.key ? (
              <StoryEditor
                key={s.key}
                brief={p.brief}
                outOfScope={p.out_of_scope.map((o) => o.line)}
                others={stories.filter((o) => o.key !== s.key)}
                initial={s}
                busy={busy}
                warnApproved={s.status === "approved"}
                onCancel={() => setEditing(null)}
                onSave={async ({ key, ...patch }) => {
                  if (await run((ver) => api.update(p.id, ver, key, patch))) setEditing(null);
                }}
              />
            ) : (
              <StoryCard
                key={s.key}
                story={s}
                user={user}
                locked={locked}
                busy={busy}
                findings={check.findings.filter((f) => f.story === s.key)}
                onEdit={() => setEditing(s.key)}
                onApprove={() => run((ver) => api.approve(p.id, ver, s.key))}
                onReopen={() => run((ver) => api.reopen(p.id, ver, s.key))}
                onDelete={() => confirm(`Delete ${s.key}?`) && run((ver) => api.remove(p.id, ver, s.key))}
              />
            ),
          )}
        </section>
      </div>

      <section className="card activity">
        <div className="stories-head">
          <h2>What happened</h2>
          <a className="ghost-link" href={`/api/projects/${p.id}/plan.md`} target="_blank" rel="noreferrer">
            Export as Markdown ↗
          </a>
        </div>
        <ol>
          {v.events.map((e) => (
            <li key={e.id}>
              <time>{new Date(e.at).toLocaleString()}</time> {describe(e)}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Stat({ n, label, tone, title }: { n: number | string; label: string; tone?: "good" | "bad" | "warn"; title?: string }) {
  return (
    <div className={`stat ${tone ?? ""}`} title={title}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function DraftControls({ drafters, busy, disabledReason, onDraft }: { drafters: DrafterInfo[]; busy: boolean; disabledReason: string; onDraft: (n: string) => void }) {
  const [pick, setPick] = useState<string>("");
  const usable = drafters.filter((d) => d.available);
  const chosen = drafters.find((d) => d.name === pick) ?? usable[0];
  return (
    <div className="draft">
      <label className="inline">
        Draft with
        <select value={chosen?.name ?? ""} onChange={(e) => setPick(e.target.value)}>
          {drafters.map((d) => (
            <option key={d.name} value={d.name} disabled={!d.available}>
              {d.label}
              {d.available ? "" : " (off)"}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy || !chosen || !!disabledReason} onClick={() => chosen && onDraft(chosen.name)}>
        {busy ? "Working…" : "Draft stories"}
      </button>
      <span className="muted small">{disabledReason || chosen?.note}</span>
    </div>
  );
}

function BriefPanel({ view, locked, busy, onScope }: { view: PlanView; locked: boolean; busy: boolean; onScope: (line: number, out: boolean, reason?: string) => void }) {
  const { project: p, check } = view;
  const out = new Map(p.out_of_scope.map((o) => [o.line, o]));
  const [asking, setAsking] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  return (
    <section className="card brief">
      <h2>Brief</h2>
      <p className="muted small">Every requirement line needs a story, or a reason it was left out.</p>
      <ol className="lines">
        {briefLines(p.brief).map((l) => {
          const keys = check.coverage[l.n];
          const o = out.get(l.n);
          const state = !l.requirement ? "plain" : o ? "out" : keys ? "covered" : "missing";
          return (
            <li key={l.n} className={state}>
              <span className="n">{l.n}</span>
              <div>
                <span className="text">{l.text.replace(/^#+\s*/, "") || "\u00a0"}</span>
                {state === "covered" && <span className="chips">{keys!.map((k) => <button key={k} type="button" className="chip" onClick={() => jumpTo(k)}>{k}</button>)}</span>}
                {state === "out" && (
                  <span className="outnote">
                    Left out by {o!.by}: {o!.reason}
                    {!locked && (
                      <button className="linkish" disabled={busy} onClick={() => onScope(l.n, false)}>
                        Bring back
                      </button>
                    )}
                  </span>
                )}
                {state === "missing" && !locked && asking !== l.n && (
                  <span className="missingnote">
                    No story yet.{" "}
                    <button className="linkish" onClick={() => { setAsking(l.n); setReason(""); }}>
                      Leave it out…
                    </button>
                  </span>
                )}
                {asking === l.n && (
                  <form
                    className="why"
                    onSubmit={(e) => {
                      e.preventDefault();
                      onScope(l.n, true, reason);
                      setAsking(null);
                    }}
                  >
                    <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? The client will see this." maxLength={200} />
                    <button disabled={busy || reason.trim().length < 5}>Save</button>
                    <button type="button" className="linkish" onClick={() => setAsking(null)}>
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StoryCard(props: {
  story: Story;
  user: string;
  locked: boolean;
  busy: boolean;
  findings: Finding[];
  onEdit: () => void;
  onApprove: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const { story: s, user, locked, busy, findings } = props;
  const blocks = findings.filter((f) => f.severity === "block");
  const own = s.edited_by === user;
  const approveWhy = own ? `You last changed ${s.key}. Someone else has to approve it.` : blocks.length ? `Fix ${blocks.length} ${blocks.length === 1 ? "problem" : "problems"} first.` : "";
  return (
    <article id={`story-${s.key}`} className={`story ${s.status} ${blocks.length ? "has-block" : ""}`}>
      <header>
        <span className="key">{s.key}</span>
        <h3>{s.title}</h3>
        <span className="hours">{s.estimate_hours} h</span>
      </header>
      {s.description && <p className="desc">{s.description}</p>}
      {s.acceptance.length > 0 && (
        <ul className="acc">
          {s.acceptance.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      <p className="meta">
        From line {s.brief_lines.join(", ") || "none"}
        {s.depends_on.length > 0 && <> · needs {s.depends_on.join(", ")}</>} · {SOURCE_LABEL[s.source]}
        {s.edited_by && <> · last changed by {s.edited_by}</>}
      </p>
      {findings.length > 0 && (
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={i} className={f.severity}>
              <span className="sev">{f.severity === "block" ? "Must fix" : "Check"}</span> {f.message}
            </li>
          ))}
        </ul>
      )}
      <footer>
        {s.status === "approved" ? (
          <>
            <span className="ok">✓ Approved by {s.approved_by}</span>
            {!locked && (
              <button className="ghost" disabled={busy} onClick={props.onReopen}>
                Reopen
              </button>
            )}
          </>
        ) : (
          !locked && (
            <>
              <button className="approve" disabled={busy || !!approveWhy} onClick={props.onApprove} title={approveWhy}>
                Approve
              </button>
              {approveWhy && <span className="muted small">{approveWhy}</span>}
            </>
          )
        )}
        {!locked && (
          <span className="tools">
            <button className="linkish" onClick={props.onEdit}>
              Edit
            </button>
            <button className="linkish danger" disabled={busy} onClick={props.onDelete}>
              Delete
            </button>
          </span>
        )}
      </footer>
    </article>
  );
}

function StoryEditor(props: {
  brief: string;
  outOfScope: number[];
  others: Story[];
  initial: DraftStory;
  busy: boolean;
  warnApproved?: boolean;
  onCancel: () => void;
  onSave: (s: DraftStory) => void;
}) {
  const { initial } = props;
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [acceptance, setAcceptance] = useState(initial.acceptance.join("\n"));
  const [hours, setHours] = useState(String(initial.estimate_hours));
  const [deps, setDeps] = useState(initial.depends_on.join(", "));
  const [lines, setLines] = useState(initial.brief_lines.join(", "));

  const draft: DraftStory = {
    key: initial.key,
    title: title.trim(),
    description: description.trim(),
    acceptance: acceptance.split("\n").map((a) => a.trim()).filter(Boolean),
    estimate_hours: Number(hours),
    depends_on: deps.split(/[\s,]+/).map((d) => d.trim().toUpperCase()).filter(Boolean),
    brief_lines: lines.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isInteger),
  };

  // The same checks the server runs, on every keystroke.
  const live = checkPlan(props.brief, [...props.others, draft], props.outOfScope).findings.filter((f) => f.story === draft.key);

  return (
    <form
      className="story editing"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave(draft);
      }}
    >
      <header>
        <span className="key">{initial.key === "NEW" ? "New" : initial.key}</span>
        <input className="title-in" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required minLength={3} maxLength={120} autoFocus />
      </header>
      {props.warnApproved && <p className="notice-inline">This story is approved. Saving a change removes the approval.</p>}
      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
      </label>
      <label>
        Acceptance criteria <span className="muted small">one per line</span>
        <textarea rows={4} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
      </label>
      <div className="row three">
        <label>
          Hours
          <input type="number" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label>
          From brief lines
          <input value={lines} onChange={(e) => setLines(e.target.value)} placeholder="3, 4" />
        </label>
        <label>
          Needs
          <input value={deps} onChange={(e) => setDeps(e.target.value)} placeholder="S1, S2" />
        </label>
      </div>
      <ul className="findings live" aria-live="polite">
        {live.length === 0 ? (
          <li className="good">No problems found.</li>
        ) : (
          live.map((f, i) => (
            <li key={i} className={f.severity}>
              <span className="sev">{f.severity === "block" ? "Must fix" : "Check"}</span> {f.message}
            </li>
          ))
        )}
      </ul>
      <footer>
        <button className="primary" disabled={props.busy}>
          Save
        </button>
        <button type="button" className="ghost" onClick={props.onCancel}>
          Cancel
        </button>
      </footer>
    </form>
  );
}

// The URL hash holds the route, so story links scroll instead of changing it.
function jumpTo(key: string) {
  const el = document.getElementById(`story-${key}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function describe(e: PlanEvent): string {
  const d = e.detail as Record<string, unknown>;
  switch (e.action) {
    case "create":
      return `${e.actor} started the plan from a brief with ${d.lines} requirement lines.`;
    case "draft": {
      const how = d.drafter === "model" ? `the model ${d.model}` : d.drafter === "rules" ? "the rule drafter" : "the sample draft";
      const retry = Array.isArray(d.rejected) && d.rejected.length ? ` Its first answer failed the schema and it fixed it on try ${d.attempts}.` : "";
      return `${e.actor} drafted ${d.stories} stories with ${how}.${retry}`;
    }
    case "add":
      return `${e.actor} added ${d.story}: "${d.title}".`;
    case "edit":
      return `${e.actor} changed ${d.story} (${(d.fields as string[]).join(", ").replace(/_/g, " ")}).${d.approval_reset ? " Its approval was removed." : ""}`;
    case "delete":
      return `${e.actor} deleted ${d.story}: "${d.title}".`;
    case "approve":
      return `${e.actor} approved ${d.story}.`;
    case "reopen":
      return `${e.actor} reopened ${d.story}.`;
    case "out_of_scope":
      return `${e.actor} left brief line ${d.line} out: "${d.reason}".`;
    case "back_in_scope":
      return `${e.actor} brought brief line ${d.line} back into scope.`;
    case "lock":
      return `${e.actor} locked the plan: ${d.stories} stories, ${d.hours} hours. Fingerprint ${d.fingerprint}.`;
    default:
      return `${e.actor}: ${e.action}`;
  }
}
