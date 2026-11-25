import Database from "better-sqlite3";
import type { PlanEvent, Project, Source, Story, StoryStatus } from "../shared/plan";

export type DB = Database.Database;

export function openDb(file = process.env.DB_FILE ?? "scopeproof.db"): DB {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      brief TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
      out_of_scope TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      locked_by TEXT,
      locked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE TABLE IF NOT EXISTS stories (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      acceptance TEXT NOT NULL,
      estimate_hours REAL NOT NULL,
      depends_on TEXT NOT NULL,
      brief_lines TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
      edited_by TEXT,
      approved_by TEXT,
      PRIMARY KEY (project_id, key)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS events_project ON events(project_id, id);
  `);
  return db;
}

type Row = Record<string, unknown>;

export function toProject(r: Row): Project {
  return { ...(r as unknown as Project), out_of_scope: JSON.parse(r.out_of_scope as string) };
}

export function toStory(r: Row): Story {
  return {
    key: r.key as string,
    title: r.title as string,
    description: r.description as string,
    acceptance: JSON.parse(r.acceptance as string),
    estimate_hours: r.estimate_hours as number,
    depends_on: JSON.parse(r.depends_on as string),
    brief_lines: JSON.parse(r.brief_lines as string),
    source: r.source as Source,
    status: r.status as StoryStatus,
    edited_by: (r.edited_by as string) ?? null,
    approved_by: (r.approved_by as string) ?? null,
  };
}

export function toEvent(r: Row): PlanEvent {
  return { ...(r as unknown as PlanEvent), detail: JSON.parse(r.detail as string) };
}
