import path from "node:path";
import { buildApp } from "./app";
import { openDb } from "./db";
import { runDrafter } from "./drafters";
import { modelConfigFromEnv } from "./drafters/model";
import { SAMPLE_BRIEF, SAMPLE_NAME } from "./drafters/sample";
import * as plans from "./plans";

const db = openDb();
const model = modelConfigFromEnv();

// A fresh database gets one plan so the first visitor has something to look at.
if (process.env.SEED !== "0" && (db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n === 0) {
  const { project } = plans.createProject(db, "Ada", { name: SAMPLE_NAME, brief: SAMPLE_BRIEF });
  const draft = await runDrafter("sample", SAMPLE_BRIEF, null);
  plans.applyDraft(db, project.id, project.version, "Ada", draft);
}

const app = buildApp({
  db,
  model,
  logger: true,
  clientDir: process.env.CLIENT_DIR ?? path.join(import.meta.dirname, "../client"),
});

const port = Number(process.env.PORT ?? 3990);
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
app.log.info(model ? `model drafter on: ${model.model}` : "no AI_API_KEY set, model drafter off");

const stop = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
