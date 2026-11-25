import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import type { DB } from "./db";
import { DraftError, listDrafters, runDrafter, type DrafterName } from "./drafters";
import { SAMPLE_BRIEF, SAMPLE_NAME } from "./drafters/sample";
import type { ModelConfig } from "./drafters/model";
import * as plans from "./plans";

export interface AppOptions {
  db: DB;
  model: ModelConfig | null;
  clientDir?: string;
  logger?: boolean;
}

type Body = Record<string, unknown> | undefined;
type IdParams = { id: string };
type KeyParams = { id: string; key: string };

export function buildApp({ db, model, clientDir, logger = false }: AppOptions) {
  const app = Fastify({ logger, bodyLimit: 64 * 1024 });

  // There is no login in this demo. People pick a name and it rides along in a
  // header. In a real deployment this comes from the company's SSO instead.
  const actor = (req: FastifyRequest): string => {
    const raw = req.headers["x-user"];
    const name = (Array.isArray(raw) ? raw[0] : raw ?? "").trim();
    if (!name || name.length > 40) throw new plans.HttpError(401, "Pick who you are first.");
    return name;
  };
  const id = (req: FastifyRequest<{ Params: IdParams }>) => {
    const n = Number(req.params.id);
    if (!Number.isInteger(n) || n < 1) throw new plans.HttpError(404, "No plan with that id.");
    return n;
  };

  // Model calls cost money, so each address gets a few per ten minutes.
  const hits = new Map<string, number[]>();
  const modelBudget = (ip: string) => {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= 6) throw new plans.HttpError(429, "That is 6 model drafts in 10 minutes. Try again a bit later.");
    hits.set(ip, [...recent, now]);
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof plans.HttpError) return reply.code(err.status).send({ error: err.message, ...err.extra });
    if (err instanceof DraftError) return reply.code(502).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.code(500).send({ error: "Something broke on the server." });
  });

  app.get("/api/health", async () => ({ ok: true, model: !!model }));
  app.get("/api/drafters", async () => listDrafters(model));
  app.get("/api/sample", async () => ({ name: SAMPLE_NAME, brief: SAMPLE_BRIEF }));
  app.get("/api/projects", async () => plans.listProjects(db));

  app.post<{ Body: Body }>("/api/projects", async (req, reply) => {
    reply.code(201);
    return plans.createProject(db, actor(req), req.body);
  });

  app.get<{ Params: IdParams }>("/api/projects/:id", async (req) => plans.view(db, id(req)));

  app.get<{ Params: IdParams }>("/api/projects/:id/plan.md", async (req, reply) => {
    reply.type("text/markdown; charset=utf-8");
    return plans.exportMarkdown(db, id(req));
  });

  app.post<{ Params: IdParams; Body: Body }>("/api/projects/:id/draft", async (req) => {
    const who = actor(req);
    const pid = id(req);
    const name = req.body?.drafter as DrafterName;
    if (!["model", "rules", "sample"].includes(name)) throw new plans.HttpError(422, "Unknown drafter.");
    const { project } = plans.view(db, pid);
    if (project.status === "locked") throw new plans.HttpError(409, "This plan is locked. Nothing can change now.");
    if (name === "model") modelBudget(req.ip);
    const draft = await runDrafter(name, project.brief, model);
    return plans.applyDraft(db, pid, req.body?.version, who, draft);
  });

  app.post<{ Params: IdParams; Body: Body }>("/api/projects/:id/stories", async (req) =>
    plans.addStory(db, id(req), req.body?.version, actor(req), req.body?.story),
  );

  app.patch<{ Params: KeyParams; Body: Body }>("/api/projects/:id/stories/:key", async (req) =>
    plans.updateStory(db, id(req), req.params.key, req.body?.version, actor(req), req.body?.patch),
  );

  app.delete<{ Params: KeyParams; Querystring: { version?: string } }>("/api/projects/:id/stories/:key", async (req) =>
    plans.deleteStory(db, id(req), req.params.key, Number(req.query.version), actor(req)),
  );

  app.post<{ Params: KeyParams; Body: Body }>("/api/projects/:id/stories/:key/approve", async (req) =>
    plans.approveStory(db, id(req), req.params.key, req.body?.version, actor(req)),
  );

  app.post<{ Params: KeyParams; Body: Body }>("/api/projects/:id/stories/:key/reopen", async (req) =>
    plans.reopenStory(db, id(req), req.params.key, req.body?.version, actor(req)),
  );

  app.post<{ Params: IdParams; Body: Body }>("/api/projects/:id/scope", async (req) =>
    plans.setScope(db, id(req), req.body?.version, actor(req), req.body),
  );

  app.post<{ Params: IdParams; Body: Body }>("/api/projects/:id/lock", async (req) =>
    plans.lockPlan(db, id(req), req.body?.version, actor(req)),
  );

  if (clientDir && existsSync(clientDir)) {
    app.register(fastifyStatic, { root: path.resolve(clientDir) });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found." });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
