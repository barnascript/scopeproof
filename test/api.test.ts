import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app";
import { openDb } from "../src/server/db";
import { SAMPLE_BRIEF } from "../src/server/drafters/sample";
import type { PlanView } from "../src/server/plans";

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp({ db: openDb(":memory:"), model: null });
});

async function as(user: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
  const res = await app.inject({ method, url, payload, headers: { "x-user": user } });
  return { status: res.statusCode, body: res.json() };
}

async function newPlan(drafter = "sample"): Promise<PlanView> {
  const created = await as("Ada", "POST", "/api/projects", { name: "Tutors", brief: SAMPLE_BRIEF });
  expect(created.status).toBe(201);
  const p = created.body as PlanView;
  const d = await as("Ada", "POST", `/api/projects/${p.project.id}/draft`, { drafter, version: p.project.version });
  expect(d.status).toBe(200);
  return d.body;
}

describe("plan flow", () => {
  it("needs a name before anything changes", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "X1", brief: SAMPLE_BRIEF } });
    expect(res.statusCode).toBe(401);
  });

  it("refuses the model drafter when no key is set", async () => {
    const p = (await as("Ada", "POST", "/api/projects", { name: "Tutors", brief: SAMPLE_BRIEF })).body as PlanView;
    const r = await as("Ada", "POST", `/api/projects/${p.project.id}/draft`, { drafter: "model", version: 1 });
    expect(r.status).toBe(502);
  });

  it("does not let you approve your own draft", async () => {
    const v = await newPlan("rules");
    const r = await as("Ada", "POST", `/api/projects/${v.project.id}/stories/S1/approve`, { version: v.project.version });
    expect(r.status).toBe(403);
  });

  it("does not approve a story that still has blocking problems", async () => {
    const v = await newPlan();
    const r = await as("Tunde", "POST", `/api/projects/${v.project.id}/stories/S8/approve`, { version: v.project.version });
    expect(r.status).toBe(422);
    expect(r.body.findings[0].code).toBe("NO_ACCEPTANCE");
  });

  it("rejects a change made on an old version", async () => {
    const v = await newPlan();
    const url = `/api/projects/${v.project.id}/stories/S2`;
    const first = await as("Tunde", "PATCH", url, { version: v.project.version, patch: { estimate_hours: 7 } });
    expect(first.status).toBe(200);
    const stale = await as("Chioma", "PATCH", url, { version: v.project.version, patch: { estimate_hours: 9 } });
    expect(stale.status).toBe(409);
    expect(stale.body.version).toBe(first.body.project.version);
  });

  it("removes an approval when the story changes", async () => {
    let v = await newPlan("rules");
    const id = v.project.id;
    v = (await as("Tunde", "POST", `/api/projects/${id}/stories/S1/approve`, { version: v.project.version })).body;
    expect(v.stories[0].status).toBe("approved");
    v = (await as("Ada", "PATCH", `/api/projects/${id}/stories/S1`, { version: v.project.version, patch: { estimate_hours: 9 } })).body;
    expect(v.stories[0]).toMatchObject({ status: "draft", approved_by: null, edited_by: "Ada" });
    expect(v.events[0].detail).toMatchObject({ approval_reset: true });
  });

  it("walks the sample from a messy draft to a locked plan", async () => {
    let v = await newPlan();
    const id = v.project.id;
    const step = async (user: string, method: "POST" | "PATCH" | "DELETE", url: string, payload: object = {}) => {
      const r = await as(user, method, `/api/projects/${id}${url}`, { version: v.project.version, ...payload });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      v = r.body;
    };

    // Tunde fixes what the checks found.
    await step("Tunde", "PATCH", "/stories/S5", { patch: { depends_on: [] } });
    await step("Tunde", "PATCH", "/stories/S2", { patch: { acceptance: ["Parents can filter by subject, level and area together.", "Results show within 1 second."] } });
    await step("Tunde", "PATCH", "/stories/S8", { patch: { acceptance: ["Only parents who had the lesson can review it.", "One review per lesson."] } });
    await step("Tunde", "DELETE", `/stories/S9?version=${v.project.version}`);
    await step("Tunde", "DELETE", `/stories/S10?version=${v.project.version}`);
    await step("Tunde", "POST", "/stories", {
      story: { title: "Admins hide reviews", acceptance: ["A hidden review disappears from the tutor page."], estimate_hours: 3, brief_lines: [11] },
    });
    await step("Tunde", "POST", "/scope", { line: 12, out: true, reason: "Speed targets agreed after the first release." });
    expect(v.check.findings.filter((f) => f.severity === "block")).toEqual([]);

    // Locking now fails: nothing is approved yet.
    const early = await as("Tunde", "POST", `/api/projects/${id}/lock`, { version: v.project.version });
    expect(early.status).toBe(422);

    // Each story is approved by whoever did not last change it.
    for (const s of v.stories) {
      await step(s.edited_by === "Ada" ? "Tunde" : "Ada", "POST", `/stories/${s.key}/approve`);
    }
    await step("Chioma", "POST", "/lock");
    expect(v.project).toMatchObject({ status: "locked", locked_by: "Chioma" });
    expect(v.events[0].detail.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    const after = await as("Ada", "PATCH", `/api/projects/${id}/stories/S1`, { version: v.project.version, patch: { estimate_hours: 1 } });
    expect(after.status).toBe(409);

    const md = await app.inject({ method: "GET", url: `/api/projects/${id}/plan.md` });
    expect(md.body).toContain("Locked by Chioma");
    expect(md.body).toContain("Left out on purpose");
  });

  it("will not delete a story others depend on", async () => {
    const v = await newPlan("rules");
    const r = await as("Ada", "DELETE", `/api/projects/${v.project.id}/stories/S1?version=${v.project.version}`);
    expect(r.status).toBe(409);
  });
});
