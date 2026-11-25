import { describe, expect, it } from "vitest";
import { checkPlan } from "../src/shared/checks";
import { briefLines } from "../src/shared/plan";
import { draftWithModel, DraftError } from "../src/server/drafters/model";
import { draftWithRules } from "../src/server/drafters/rules";
import { draftSample, SAMPLE_BRIEF } from "../src/server/drafters/sample";

const lines = briefLines(SAMPLE_BRIEF);

function fakeModel(answers: (string | { status: number })[]) {
  const calls: { messages: { role: string; content: string }[] }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    const a = answers.shift()!;
    if (typeof a !== "string") return new Response("{}", { status: a.status });
    return Response.json({ choices: [{ message: { content: a } }] });
  }) as typeof globalThis.fetch;
  return { cfg: { apiKey: "k", baseUrl: "http://model.test/v1", model: "test-model", fetch }, calls };
}

const good = JSON.stringify({
  stories: [{ key: "S1", title: "Sign up and log in", description: "", acceptance: ["Wrong password shows an error."], estimate_hours: 6, depends_on: [], brief_lines: [3] }],
});

describe("model drafter", () => {
  it("accepts a valid answer and sends the brief with line numbers", async () => {
    const { cfg, calls } = fakeModel([good]);
    const r = await draftWithModel(lines, cfg);
    expect(r.plan.stories).toHaveLength(1);
    expect(r.meta).toMatchObject({ model: "test-model", attempts: 1 });
    expect(calls[0].messages[1].content).toContain("3: Parents sign up and log in");
  });

  it("gives the model one retry with the exact schema errors", async () => {
    const bad = JSON.stringify({ stories: [{ key: "first", title: "Login", acceptance: [], estimate_hours: "6", brief_lines: [3] }] });
    const { cfg, calls } = fakeModel([bad, `\`\`\`json\n${good}\n\`\`\``]);
    const r = await draftWithModel(lines, cfg);
    expect(r.meta).toMatchObject({ attempts: 2 });
    const retry = calls[1].messages.at(-1)!.content;
    expect(retry).toContain("stories.0.key");
    expect(retry).toContain("stories.0.estimate_hours");
  });

  it("gives up after two bad answers instead of saving junk", async () => {
    const { cfg } = fakeModel(["not json", '{"stories": []}']);
    await expect(draftWithModel(lines, cfg)).rejects.toBeInstanceOf(DraftError);
  });

  it("does not pass the provider's error body through", async () => {
    const { cfg } = fakeModel([{ status: 401 }]);
    await expect(draftWithModel(lines, cfg)).rejects.toThrow("The model API answered 401.");
  });
});

describe("rule drafter", () => {
  it("makes one story per requirement line and they all cite their line", () => {
    const r = draftWithRules(lines);
    expect(r.plan.stories).toHaveLength(10);
    const check = checkPlan(SAMPLE_BRIEF, r.plan.stories);
    expect(check.uncovered).toEqual([]);
    expect(check.findings.filter((f) => f.severity === "block")).toEqual([]);
  });

  it("puts things that need an account after the login story", () => {
    const pay = draftWithRules(lines).plan.stories.find((s) => s.brief_lines[0] === 7)!;
    expect(pay.depends_on).toEqual(["S1"]);
    expect(pay.estimate_hours).toBe(12);
  });
});

describe("sample draft", () => {
  it("has the planted mistakes, and the checks catch every one", () => {
    const codes = new Set(checkPlan(SAMPLE_BRIEF, draftSample().plan.stories).findings.map((f) => f.code));
    for (const c of ["VAGUE", "LOOP", "NO_ACCEPTANCE", "BAD_SOURCE", "ESTIMATE", "DUPLICATE", "UNCOVERED"]) expect(codes).toContain(c);
  });
});
