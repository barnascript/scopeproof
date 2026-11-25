import { describe, expect, it } from "vitest";
import { checkPlan, criticalPath, findCycle, vagueWord } from "../src/shared/checks";
import type { DraftStory } from "../src/shared/plan";

const BRIEF = `# Shop

Customers log in with email and password.
Customers search products by name.
Customers pay by card at checkout.`;

const story = (over: Partial<DraftStory> & { key: string }): DraftStory => ({
  title: "Log in with email",
  description: "",
  acceptance: ["A wrong password shows an error."],
  estimate_hours: 4,
  depends_on: [],
  brief_lines: [3],
  ...over,
});

const codes = (r: ReturnType<typeof checkPlan>, key?: string) => r.findings.filter((f) => !key || f.story === key).map((f) => f.code);

describe("checkPlan", () => {
  const clean = [
    story({ key: "S1" }),
    story({ key: "S2", title: "Product search by name", brief_lines: [4], acceptance: ["Results show in under 1 second."] }),
    story({ key: "S3", title: "Card payment at checkout", brief_lines: [5], depends_on: ["S1"], estimate_hours: 10 }),
  ];

  it("passes a clean plan", () => {
    const r = checkPlan(BRIEF, clean);
    expect(r.findings).toEqual([]);
    expect(r.totalHours).toBe(18);
    expect(r.criticalPath).toEqual({ keys: ["S1", "S3"], hours: 14 });
  });

  it("blocks a story that points to no line, or a line that does not exist", () => {
    const r = checkPlan(BRIEF, [...clean, story({ key: "S4", title: "Chat", brief_lines: [] }), story({ key: "S5", title: "Wishlist", brief_lines: [40] })]);
    expect(codes(r, "S4")).toContain("NO_SOURCE");
    expect(codes(r, "S5")).toContain("BAD_SOURCE");
  });

  it("warns when the story shares no words with the line it cites", () => {
    const r = checkPlan(BRIEF, [...clean.slice(1), story({ key: "S1", title: "Dark mode theme", acceptance: ["Colours switch."] })]);
    expect(codes(r, "S1")).toEqual(["WEAK_SOURCE"]);
  });

  it("flags vague criteria but accepts them once they carry a number", () => {
    expect(vagueWord("Search is fast and easy")).toBe("fast");
    expect(vagueWord("Search returns in under 1 s")).toBeNull();
    expect(vagueWord("Breakfast menu shows")).toBeNull();
  });

  it("blocks missing criteria and estimates out of range, and warns on big ones", () => {
    const r = checkPlan(BRIEF, [
      story({ key: "S1", acceptance: [] }),
      story({ key: "S2", title: "Product search by name", brief_lines: [4], estimate_hours: 60 }),
      story({ key: "S3", title: "Card payment at checkout", brief_lines: [5], estimate_hours: 20 }),
    ]);
    expect(codes(r, "S1")).toContain("NO_ACCEPTANCE");
    expect(codes(r, "S2")).toContain("ESTIMATE");
    expect(codes(r, "S3")).toContain("TOO_BIG");
  });

  it("finds dependency loops and unknown dependencies", () => {
    const loop = [
      story({ key: "S1", depends_on: ["S3"] }),
      story({ key: "S2", title: "Product search by name", brief_lines: [4], depends_on: ["S9"] }),
      story({ key: "S3", title: "Card payment at checkout", brief_lines: [5], depends_on: ["S1"] }),
    ];
    const r = checkPlan(BRIEF, loop);
    expect(codes(r, "S1")).toContain("LOOP");
    expect(codes(r, "S3")).toContain("LOOP");
    expect(codes(r, "S2")).toEqual(["BAD_DEP"]);
    expect(findCycle(loop)).toEqual(["S1", "S3"]);
    expect(r.criticalPath.hours).toBe(0);
  });

  it("flags a repeated story", () => {
    const r = checkPlan(BRIEF, [...clean, story({ key: "S4", title: "Search products", brief_lines: [4] })]);
    expect(codes(r, "S4")).toContain("DUPLICATE");
  });

  it("needs every requirement line covered or left out on purpose", () => {
    const r = checkPlan(BRIEF, clean.slice(0, 2));
    expect(r.uncovered).toEqual([5]);
    expect(r.findings.find((f) => f.code === "UNCOVERED")?.severity).toBe("block");
    expect(checkPlan(BRIEF, clean.slice(0, 2), [5]).findings).toEqual([]);
  });
});

describe("criticalPath", () => {
  it("takes the heaviest chain, not the longest one", () => {
    const s = (key: string, h: number, deps: string[] = []) => story({ key, estimate_hours: h, depends_on: deps });
    expect(criticalPath([s("S1", 2), s("S2", 2, ["S1"]), s("S3", 2, ["S2"]), s("S4", 10)])).toEqual({ keys: ["S4"], hours: 10 });
  });
});
