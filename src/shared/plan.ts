import { z } from "zod";

// One story as it comes back from a drafter. I validate every field here
// before anything reaches the database, so a model cannot sneak in a
// missing estimate or a string where a number should be.
export const DraftStory = z.object({
  key: z.string().regex(/^S\d{1,3}$/, "key must look like S1, S2, ..."),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(600).default(""),
  acceptance: z.array(z.string().trim().min(3).max(240)).max(8),
  estimate_hours: z.number().finite(),
  depends_on: z.array(z.string()).max(10).default([]),
  brief_lines: z.array(z.number().int()).max(10),
});
export type DraftStory = z.infer<typeof DraftStory>;

export const DraftPlan = z
  .object({ stories: z.array(DraftStory).min(1).max(40) })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.stories.forEach((s, i) => {
      if (seen.has(s.key)) {
        ctx.addIssue({ code: "custom", path: ["stories", i, "key"], message: `duplicate key ${s.key}` });
      }
      seen.add(s.key);
    });
  });
export type DraftPlan = z.infer<typeof DraftPlan>;

export type Source = "model" | "rules" | "sample" | "person";
export type StoryStatus = "draft" | "approved";

export interface Story extends DraftStory {
  source: Source;
  status: StoryStatus;
  edited_by: string | null;
  approved_by: string | null;
}

export interface OutOfScope {
  line: number;
  by: string;
  reason: string;
}

export interface Project {
  id: number;
  name: string;
  brief: string;
  status: "open" | "locked";
  out_of_scope: OutOfScope[];
  version: number;
  created_by: string;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
}

export interface PlanEvent {
  id: number;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  at: string;
}

// Brief lines are numbered from 1. Blank lines and headings ("Pages:",
// "## Admin") are not requirements, so I do not expect a story for them.
export interface BriefLine {
  n: number;
  text: string;
  requirement: boolean;
}

export function briefLines(brief: string): BriefLine[] {
  return brief.split(/\r?\n/).map((raw, i) => {
    const text = raw.trim();
    const heading = /^#+\s/.test(text) || /:$/.test(text);
    return { n: i + 1, text, requirement: text.length >= 8 && !heading };
  });
}

export const LIMITS = {
  briefChars: 6000,
  briefLines: 80,
  minHours: 0.5,
  maxHours: 40,
  splitAbove: 16,
} as const;
