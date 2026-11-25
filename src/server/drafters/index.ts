import { briefLines, DraftPlan, type Source } from "../../shared/plan";
import { draftWithModel, DraftError, type ModelConfig } from "./model";
import { draftWithRules } from "./rules";
import { draftSample } from "./sample";

export interface DraftResult {
  plan: DraftPlan;
  source: Exclude<Source, "person">;
  meta: Record<string, unknown>;
}

export type DrafterName = "model" | "rules" | "sample";

export interface DrafterInfo {
  name: DrafterName;
  label: string;
  available: boolean;
  note: string;
}

export function listDrafters(model: ModelConfig | null): DrafterInfo[] {
  return [
    {
      name: "model",
      label: model ? `Language model (${model.model})` : "Language model",
      available: !!model,
      note: model ? "Sends the numbered brief to the model and checks its answer." : "Set AI_API_KEY and AI_MODEL on the server to turn this on.",
    },
    { name: "rules", label: "Rule drafter", available: true, note: "One story per brief line, sizes from a keyword table. No model." },
    {
      name: "sample",
      label: "Sample draft with mistakes",
      available: true,
      note: "A model-style answer for the tutor brief with 7 mistakes planted in it.",
    },
  ];
}

export async function runDrafter(name: DrafterName, brief: string, model: ModelConfig | null): Promise<DraftResult> {
  const lines = briefLines(brief);
  if (name === "model") {
    if (!model) throw new DraftError("No model is set up on this server.", {});
    return draftWithModel(lines, model);
  }
  if (name === "rules") {
    const r = draftWithRules(lines);
    if (r.plan.stories.length === 0) throw new DraftError("The brief has no requirement lines to draft from.", {});
    return r;
  }
  return draftSample();
}

export { DraftError };
