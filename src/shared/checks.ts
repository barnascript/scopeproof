import { briefLines, LIMITS, type BriefLine, type DraftStory } from "./plan";

// These checks run in two places: in the browser on every keystroke, and on
// the server before it accepts an approval or a lock. Same file, same rules,
// so the screen can never say "fine" while the server says "no".

export type Severity = "block" | "warn";

export interface Finding {
  code: string;
  severity: Severity;
  story?: string;
  line?: number;
  message: string;
}

const STOP = new Set(
  "a an and are as at be by can for from has have i in into is it its of on or our should so that the their them then they this to user users we when will with your you each all any via per must able need needs want".split(" "),
);

// Words that sound like a requirement but cannot be tested unless a number
// comes with them ("fast" fails, "loads in under 2 s" passes).
const VAGUE = ["fast", "quick", "quickly", "easy", "easily", "simple", "intuitive", "user-friendly", "user friendly", "seamless", "robust", "modern", "nice", "clean", "efficient", "scalable", "secure enough", "good"];

export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map(stem)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function stem(w: string): string {
  const base = w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w.replace(/s$/, "");
  return base.replace(/([b-df-hj-np-tv-z])\1$/, "$1");
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  return overlap(A, B) / new Set([...A, ...B]).size;
}

export function vagueWord(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\d/.test(lower)) return null;
  for (const v of VAGUE) {
    if (new RegExp(`(^|[^a-z-])${v}([^a-z-]|$)`).test(lower)) return v;
  }
  return null;
}

export function checkStory(s: DraftStory, lines: BriefLine[], keys: Set<string>): Finding[] {
  const out: Finding[] = [];
  const add = (code: string, severity: Severity, message: string) => out.push({ code, severity, story: s.key, message });

  if (s.brief_lines.length === 0) {
    add("NO_SOURCE", "block", "Points to no line in the brief. Say where this comes from, or drop it.");
  }
  const storyWords = words(`${s.title} ${s.description} ${s.acceptance.join(" ")}`);
  for (const n of s.brief_lines) {
    const line = lines[n - 1];
    if (!line || !line.text) {
      add("BAD_SOURCE", "block", `Points to brief line ${n}, which does not exist.`);
    } else if (overlap(storyWords, words(line.text)) === 0) {
      add("WEAK_SOURCE", "warn", `Shares no words with brief line ${n}. Check it really comes from there.`);
    }
  }

  if (s.acceptance.length === 0) {
    add("NO_ACCEPTANCE", "block", "Has no acceptance criteria, so nobody can say when it is done.");
  }
  s.acceptance.forEach((a, i) => {
    const v = vagueWord(a);
    if (v) add("VAGUE", "warn", `Criterion ${i + 1} says "${v}" with no number. Make it testable.`);
  });

  if (!(s.estimate_hours >= LIMITS.minHours && s.estimate_hours <= LIMITS.maxHours)) {
    add("ESTIMATE", "block", `${s.estimate_hours} h is outside ${LIMITS.minHours}–${LIMITS.maxHours} h. Split it or fix the number.`);
  } else if (s.estimate_hours > LIMITS.splitAbove) {
    add("TOO_BIG", "warn", `${s.estimate_hours} h is big for one story. Think about splitting it.`);
  }

  for (const d of s.depends_on) {
    if (d === s.key) add("SELF_DEP", "block", "Depends on itself.");
    else if (!keys.has(d)) add("BAD_DEP", "block", `Depends on ${d}, which is not in the plan.`);
  }
  return out;
}

// Returns the keys that sit on a dependency loop, if any.
export function findCycle(stories: DraftStory[]): string[] | null {
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (k: string): string[] | null => {
    if (state.get(k) === 2) return null;
    if (state.get(k) === 1) return stack.slice(stack.indexOf(k));
    state.set(k, 1);
    stack.push(k);
    for (const d of byKey.get(k)?.depends_on ?? []) {
      if (!byKey.has(d) || d === k) continue;
      const loop = visit(d);
      if (loop) return loop;
    }
    stack.pop();
    state.set(k, 2);
    return null;
  };
  for (const s of stories) {
    const loop = visit(s.key);
    if (loop) return loop;
  }
  return null;
}

export interface CheckResult {
  findings: Finding[];
  coverage: Record<number, string[]>;
  uncovered: number[];
  totalHours: number;
  criticalPath: { keys: string[]; hours: number };
}

export function checkPlan(brief: string, stories: DraftStory[], outOfScope: number[] = []): CheckResult {
  const lines = briefLines(brief);
  const keys = new Set(stories.map((s) => s.key));
  const findings: Finding[] = [];

  for (const s of stories) findings.push(...checkStory(s, lines, keys));

  for (let i = 0; i < stories.length; i++) {
    for (let j = i + 1; j < stories.length; j++) {
      if (similarity(stories[i].title, stories[j].title) >= 0.6) {
        findings.push({
          code: "DUPLICATE",
          severity: "warn",
          story: stories[j].key,
          message: `Looks like a repeat of ${stories[i].key} ("${stories[i].title}").`,
        });
      }
    }
  }

  const loop = findCycle(stories);
  if (loop) {
    const path = [...loop, loop[0]].join(" → ");
    for (const key of loop) {
      findings.push({ code: "LOOP", severity: "block", story: key, message: `Dependency loop ${path}. None of these can start.` });
    }
  }

  const coverage: Record<number, string[]> = {};
  for (const s of stories) {
    for (const n of s.brief_lines) (coverage[n] ??= []).push(s.key);
  }
  const skip = new Set(outOfScope);
  const uncovered = lines.filter((l) => l.requirement && !coverage[l.n] && !skip.has(l.n)).map((l) => l.n);
  for (const n of uncovered) {
    findings.push({
      code: "UNCOVERED",
      severity: "block",
      line: n,
      message: `Brief line ${n} has no story. Add one, or mark it out of scope on purpose.`,
    });
  }

  const totalHours = round(stories.reduce((sum, s) => sum + (Number.isFinite(s.estimate_hours) ? s.estimate_hours : 0), 0));
  return { findings, coverage, uncovered, totalHours, criticalPath: loop ? { keys: [], hours: 0 } : criticalPath(stories) };
}

// Longest chain of hours through the dependencies. With more people the plan
// can never finish faster than this.
export function criticalPath(stories: DraftStory[]): { keys: string[]; hours: number } {
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const memo = new Map<string, { keys: string[]; hours: number }>();
  const best = (k: string): { keys: string[]; hours: number } => {
    const hit = memo.get(k);
    if (hit) return hit;
    const s = byKey.get(k)!;
    let tail = { keys: [] as string[], hours: 0 };
    for (const d of s.depends_on) {
      if (!byKey.has(d) || d === k) continue;
      const c = best(d);
      if (c.hours > tail.hours) tail = c;
    }
    const own = Number.isFinite(s.estimate_hours) ? s.estimate_hours : 0;
    const r = { keys: [...tail.keys, k], hours: round(tail.hours + own) };
    memo.set(k, r);
    return r;
  };
  let top = { keys: [] as string[], hours: 0 };
  for (const s of stories) {
    const c = best(s.key);
    if (c.hours > top.hours) top = c;
  }
  return top;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function blocksFor(findings: Finding[], key: string): Finding[] {
  return findings.filter((f) => f.severity === "block" && f.story === key);
}
