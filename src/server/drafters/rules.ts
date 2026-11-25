import type { BriefLine, DraftStory } from "../../shared/plan";
import type { DraftResult } from "./index";

// A plain, predictable drafter with no model behind it: one story per
// requirement line, estimates from a keyword table. It is the fallback when
// no API key is set, and a good baseline to compare a model against.

const SIZES: [RegExp, number, string?][] = [
  [/\b(pay|payment|card|checkout|refund|invoice)\b/i, 12, "A failed payment leaves the order unpaid and shows the reason."],
  [/\b(log ?in|sign ?up|sign ?in|password|account)\b/i, 8, "A wrong password shows an error and does not sign the person in."],
  [/\b(calendar|slot|book|booking|schedule)\b/i, 10, "Two people cannot book the same slot; the second one sees it is taken."],
  [/\b(search|filter|find)\b/i, 6, "Results show within 1 second for 1,000 records."],
  [/\b(email|notify|notification|sms)\b/i, 4, "The message arrives within 1 minute of the action."],
  [/\b(admin|moderate|hide|ban)\b/i, 5, "Only admins see the control; other users get a 403."],
  [/\b(upload|photo|image|file)\b/i, 5, "Files over 5 MB are refused with a clear message."],
  [/\b(report|dashboard|chart|export)\b/i, 8, "Totals match the database to the cent for a test month."],
];

const NEEDS_LOGIN = /\b(my|their|book|pay|cancel|review|admin|profile|dashboard|order)\b/i;
const IS_LOGIN = /\b(log ?in|sign ?up|sign ?in)\b/i;

export function draftWithRules(lines: BriefLine[]): DraftResult {
  const reqs = lines.filter((l) => l.requirement);
  const loginLine = reqs.find((l) => IS_LOGIN.test(l.text));
  const stories: DraftStory[] = reqs.map((l, i) => {
    const key = `S${i + 1}`;
    const match = SIZES.find(([re]) => re.test(l.text));
    const acceptance = [`Done when: ${l.text.replace(/\.$/, "")}.`];
    if (match?.[2]) acceptance.push(match[2]);
    const depends =
      loginLine && l !== loginLine && NEEDS_LOGIN.test(l.text) ? [`S${reqs.indexOf(loginLine) + 1}`] : [];
    return {
      key,
      title: titleFrom(l.text),
      description: l.text,
      acceptance,
      estimate_hours: match?.[1] ?? 4,
      depends_on: depends,
      brief_lines: [l.n],
    };
  });
  return { plan: { stories }, source: "rules", meta: { stories: stories.length } };
}

function titleFrom(text: string): string {
  const t = text.replace(/\.$/, "").replace(/^(the |a |an )/i, "");
  const short = t.length > 70 ? `${t.slice(0, 67).replace(/\s\S*$/, "")}…` : t;
  return short.charAt(0).toUpperCase() + short.slice(1);
}
