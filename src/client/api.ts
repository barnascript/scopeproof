import type { CheckResult } from "../shared/checks";
import type { DraftStory, PlanEvent, Project, Story } from "../shared/plan";

export interface PlanView {
  project: Project;
  stories: Story[];
  check: CheckResult;
  events: PlanEvent[];
}

export interface ProjectRow {
  id: number;
  name: string;
  status: "open" | "locked";
  created_by: string;
  created_at: string;
  stories: number;
  approved: number;
}

export interface DrafterInfo {
  name: "model" | "rules" | "sample";
  label: string;
  available: boolean;
  note: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
}

let currentUser = "";
export function setUser(name: string) {
  currentUser = name;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-user": currentUser },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data);
  return data as T;
}

export const api = {
  projects: () => call<ProjectRow[]>("GET", "/api/projects"),
  drafters: () => call<DrafterInfo[]>("GET", "/api/drafters"),
  sample: () => call<{ name: string; brief: string }>("GET", "/api/sample"),
  create: (name: string, brief: string) => call<PlanView>("POST", "/api/projects", { name, brief }),
  plan: (id: number) => call<PlanView>("GET", `/api/projects/${id}`),
  draft: (id: number, version: number, drafter: string) => call<PlanView>("POST", `/api/projects/${id}/draft`, { version, drafter }),
  add: (id: number, version: number, story: Omit<DraftStory, "key">) => call<PlanView>("POST", `/api/projects/${id}/stories`, { version, story }),
  update: (id: number, version: number, key: string, patch: Partial<DraftStory>) =>
    call<PlanView>("PATCH", `/api/projects/${id}/stories/${key}`, { version, patch }),
  remove: (id: number, version: number, key: string) => call<PlanView>("DELETE", `/api/projects/${id}/stories/${key}?version=${version}`),
  approve: (id: number, version: number, key: string) => call<PlanView>("POST", `/api/projects/${id}/stories/${key}/approve`, { version }),
  reopen: (id: number, version: number, key: string) => call<PlanView>("POST", `/api/projects/${id}/stories/${key}/reopen`, { version }),
  scope: (id: number, version: number, line: number, out: boolean, reason = "") =>
    call<PlanView>("POST", `/api/projects/${id}/scope`, { version, line, out, reason }),
  lock: (id: number, version: number) => call<PlanView>("POST", `/api/projects/${id}/lock`, { version }),
};
