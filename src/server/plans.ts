import { createHash } from "node:crypto";
import { z } from "zod";
import { checkPlan, type CheckResult } from "../shared/checks";
import { briefLines, DraftStory, LIMITS, type PlanEvent, type Project, type Story } from "../shared/plan";
import { toEvent, toProject, toStory, type DB } from "./db";
import type { DraftResult } from "./drafters";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface PlanView {
  project: Project;
  stories: Story[];
  check: CheckResult;
  events: PlanEvent[];
}

const NewProject = z.object({
  name: z.string().trim().min(2).max(80),
  brief: z
    .string()
    .trim()
    .min(20, "The brief is too short to plan from.")
    .max(LIMITS.briefChars)
    .refine((b) => b.split(/\r?\n/).length <= LIMITS.briefLines, `Keep the brief under ${LIMITS.briefLines} lines.`),
});

export function listProjects(db: DB) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.status, p.created_by, p.created_at,
              (SELECT COUNT(*) FROM stories s WHERE s.project_id = p.id) AS stories,
              (SELECT COUNT(*) FROM stories s WHERE s.project_id = p.id AND s.status = 'approved') AS approved
         FROM projects p ORDER BY p.id DESC LIMIT 200`,
    )
    .all();
}

export function createProject(db: DB, actor: string, input: unknown): PlanView {
  const { name, brief } = parseOr422(NewProject, input);
  const id = db.transaction(() => {
    const r = db.prepare("INSERT INTO projects (name, brief, created_by) VALUES (?, ?, ?)").run(name, brief, actor);
    const pid = Number(r.lastInsertRowid);
    logEvent(db, pid, actor, "create", { lines: briefLines(brief).filter((l) => l.requirement).length });
    return pid;
  })();
  return view(db, id);
}

export function view(db: DB, id: number): PlanView {
  const project = loadProject(db, id);
  const stories = loadStories(db, id);
  const events = db
    .prepare("SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 200")
    .all(id)
    .map((r) => toEvent(r as Record<string, unknown>));
  return { project, stories, check: runChecks(project, stories), events };
}

function runChecks(project: Project, stories: Story[]): CheckResult {
  return checkPlan(project.brief, stories, project.out_of_scope.map((o) => o.line));
}

// Every change goes through here: one transaction, the project must still be
// open, and the caller must have seen the latest version (otherwise two
// people editing at once would silently overwrite each other).
function change(db: DB, id: number, version: unknown, fn: (p: Project) => void): PlanView {
  db.transaction(() => {
    const p = loadProject(db, id);
    if (p.status === "locked") throw new HttpError(409, "This plan is locked. Nothing can change now.");
    if (version !== p.version) {
      throw new HttpError(409, "Someone changed this plan after you loaded it. Reload to see their change.", { version: p.version });
    }
    fn(p);
    db.prepare("UPDATE projects SET version = version + 1 WHERE id = ?").run(id);
  })();
  return view(db, id);
}

export function applyDraft(db: DB, id: number, version: unknown, actor: string, draft: DraftResult): PlanView {
  return change(db, id, version, () => {
    const approved = loadStories(db, id).filter((s) => s.status === "approved");
    if (approved.length) {
      throw new HttpError(409, `Redrafting would throw away ${approved.length} approved stories. Reopen them first.`);
    }
    db.prepare("DELETE FROM stories WHERE project_id = ?").run(id);
    draft.plan.stories.forEach((s, i) => insertStory(db, id, i, s, draft.source, actor));
    logEvent(db, id, actor, "draft", { drafter: draft.source, stories: draft.plan.stories.length, ...draft.meta });
  });
}

const StoryPatch = DraftStory.omit({ key: true }).partial().strict();
const NewStory = DraftStory.omit({ key: true }).extend({
  description: z.string().trim().max(600).default(""),
  depends_on: z.array(z.string()).max(10).default([]),
});

export function addStory(db: DB, id: number, version: unknown, actor: string, input: unknown): PlanView {
  const s = parseOr422(NewStory, input);
  return change(db, id, version, () => {
    const stories = loadStories(db, id);
    const next = stories.reduce((m, x) => Math.max(m, Number(x.key.slice(1))), 0) + 1;
    const key = `S${next}`;
    insertStory(db, id, stories.length, { ...s, key }, "person", actor);
    logEvent(db, id, actor, "add", { story: key, title: s.title });
  });
}

export function updateStory(db: DB, id: number, key: string, version: unknown, actor: string, input: unknown): PlanView {
  const patch = parseOr422(StoryPatch, input);
  return change(db, id, version, () => {
    const story = mustStory(db, id, key);
    const fields = Object.keys(patch).filter(
      (f) => JSON.stringify(patch[f as keyof typeof patch]) !== JSON.stringify(story[f as keyof Story]),
    );
    if (fields.length === 0) return;
    const next = { ...story, ...patch };
    db.prepare(
      `UPDATE stories SET title = ?, description = ?, acceptance = ?, estimate_hours = ?, depends_on = ?, brief_lines = ?,
              status = 'draft', approved_by = NULL, edited_by = ?
        WHERE project_id = ? AND key = ?`,
    ).run(
      next.title,
      next.description,
      JSON.stringify(next.acceptance),
      next.estimate_hours,
      JSON.stringify(next.depends_on),
      JSON.stringify(next.brief_lines),
      actor,
      id,
      key,
    );
    // An approval is for the exact text someone read. Change it and it is gone.
    logEvent(db, id, actor, "edit", { story: key, fields, approval_reset: story.status === "approved" });
  });
}

export function deleteStory(db: DB, id: number, key: string, version: unknown, actor: string): PlanView {
  return change(db, id, version, () => {
    const story = mustStory(db, id, key);
    const users = loadStories(db, id).filter((s) => s.depends_on.includes(key));
    if (users.length) {
      throw new HttpError(409, `${users.map((s) => s.key).join(", ")} depend on ${key}. Change those first.`);
    }
    db.prepare("DELETE FROM stories WHERE project_id = ? AND key = ?").run(id, key);
    logEvent(db, id, actor, "delete", { story: key, title: story.title, source: story.source });
  });
}

export function approveStory(db: DB, id: number, key: string, version: unknown, actor: string): PlanView {
  return change(db, id, version, (p) => {
    const story = mustStory(db, id, key);
    if (story.status === "approved") throw new HttpError(409, `${key} is already approved.`);
    if (story.edited_by === actor) {
      throw new HttpError(403, `You wrote or last changed ${key}, so someone else has to approve it.`);
    }
    const blocks = runChecks(p, loadStories(db, id)).findings.filter((f) => f.severity === "block" && f.story === key);
    if (blocks.length) throw new HttpError(422, `${key} still has problems that must be fixed first.`, { findings: blocks });
    db.prepare("UPDATE stories SET status = 'approved', approved_by = ? WHERE project_id = ? AND key = ?").run(actor, id, key);
    logEvent(db, id, actor, "approve", { story: key });
  });
}

export function reopenStory(db: DB, id: number, key: string, version: unknown, actor: string): PlanView {
  return change(db, id, version, () => {
    const story = mustStory(db, id, key);
    if (story.status !== "approved") throw new HttpError(409, `${key} is not approved.`);
    db.prepare("UPDATE stories SET status = 'draft', approved_by = NULL WHERE project_id = ? AND key = ?").run(id, key);
    logEvent(db, id, actor, "reopen", { story: key });
  });
}

const Scope = z.object({ line: z.number().int().min(1), out: z.boolean(), reason: z.string().trim().max(200).default("") });

export function setScope(db: DB, id: number, version: unknown, actor: string, input: unknown): PlanView {
  const { line, out, reason } = parseOr422(Scope, input);
  return change(db, id, version, (p) => {
    const bl = briefLines(p.brief)[line - 1];
    if (!bl?.requirement) throw new HttpError(422, `Line ${line} is not a requirement line.`);
    if (out && reason.length < 5) throw new HttpError(422, "Say why this line is out of scope, so the client sees the reason.");
    const rest = p.out_of_scope.filter((o) => o.line !== line);
    const next = out ? [...rest, { line, by: actor, reason }] : rest;
    db.prepare("UPDATE projects SET out_of_scope = ? WHERE id = ?").run(JSON.stringify(next), id);
    logEvent(db, id, actor, out ? "out_of_scope" : "back_in_scope", { line, reason: out ? reason : undefined });
  });
}

export function lockPlan(db: DB, id: number, version: unknown, actor: string): PlanView {
  return change(db, id, version, (p) => {
    const stories = loadStories(db, id);
    if (stories.length === 0) throw new HttpError(422, "There is nothing to lock yet.");
    const waiting = stories.filter((s) => s.status !== "approved").map((s) => s.key);
    const check = runChecks(p, stories);
    const blocks = check.findings.filter((f) => f.severity === "block");
    if (waiting.length || blocks.length) {
      throw new HttpError(422, "The plan is not ready to lock.", { waiting, findings: blocks });
    }
    const fingerprint = planFingerprint(p, stories);
    db.prepare("UPDATE projects SET status = 'locked', locked_by = ?, locked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(actor, id);
    logEvent(db, id, actor, "lock", { stories: stories.length, hours: check.totalHours, fingerprint });
  });
}

// A short hash of what was agreed. If anyone later says "the plan said X",
// the hash in the export settles it.
export function planFingerprint(p: Project, stories: Story[]): string {
  const body = JSON.stringify({ brief: p.brief, out: p.out_of_scope, stories: stories.map(({ edited_by, approved_by, ...s }) => s) });
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function exportMarkdown(db: DB, id: number): string {
  const { project: p, stories, check, events } = view(db, id);
  const lockEvent = events.find((e) => e.action === "lock");
  const out: string[] = [`# ${p.name}`, ""];
  out.push(
    p.status === "locked"
      ? `Locked by ${p.locked_by} on ${p.locked_at}. Fingerprint \`${lockEvent?.detail.fingerprint}\`.`
      : "Draft. Not locked yet, so this can still change.",
  );
  out.push("", `**${stories.length} stories, ${check.totalHours} hours.** Longest chain: ${check.criticalPath.keys.join(" → ") || "none"} (${check.criticalPath.hours} h).`, "");
  for (const s of stories) {
    out.push(`## ${s.key}. ${s.title} (${s.estimate_hours} h)`);
    if (s.description) out.push("", s.description);
    out.push("", `From brief line ${s.brief_lines.join(", ")}.${s.depends_on.length ? ` Needs ${s.depends_on.join(", ")}.` : ""}`);
    out.push(`Drafted by: ${s.source}. Last changed by ${s.edited_by ?? "nobody"}, approved by ${s.approved_by ?? "nobody yet"}.`, "");
    for (const a of s.acceptance) out.push(`- [ ] ${a}`);
    out.push("");
  }
  if (p.out_of_scope.length) {
    out.push("## Left out on purpose", "");
    const lines = briefLines(p.brief);
    for (const o of p.out_of_scope) out.push(`- Line ${o.line}: "${lines[o.line - 1]?.text}". ${o.reason} (${o.by})`);
  }
  return `${out.join("\n").trim()}\n`;
}

function insertStory(db: DB, id: number, position: number, s: DraftStory, source: string, actor: string) {
  db.prepare(
    `INSERT INTO stories (project_id, key, position, title, description, acceptance, estimate_hours, depends_on, brief_lines, source, edited_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    s.key,
    position,
    s.title,
    s.description,
    JSON.stringify(s.acceptance),
    s.estimate_hours,
    JSON.stringify(s.depends_on),
    JSON.stringify(s.brief_lines),
    source,
    actor,
  );
}

function loadProject(db: DB, id: number): Project {
  const r = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!r) throw new HttpError(404, "No plan with that id.");
  return toProject(r as Record<string, unknown>);
}

function loadStories(db: DB, id: number): Story[] {
  return db
    .prepare("SELECT * FROM stories WHERE project_id = ? ORDER BY position, key")
    .all(id)
    .map((r) => toStory(r as Record<string, unknown>));
}

function mustStory(db: DB, id: number, key: string): Story {
  const r = db.prepare("SELECT * FROM stories WHERE project_id = ? AND key = ?").get(id, key);
  if (!r) throw new HttpError(404, `No story ${key} in this plan.`);
  return toStory(r as Record<string, unknown>);
}

function logEvent(db: DB, id: number, actor: string, action: string, detail: Record<string, unknown>) {
  db.prepare("INSERT INTO events (project_id, actor, action, detail) VALUES (?, ?, ?, ?)").run(id, actor, action, JSON.stringify(detail));
}

function parseOr422<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(422, `${issue.path.join(".") || "input"}: ${issue.message}`);
  }
  return r.data;
}
