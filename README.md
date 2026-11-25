# Scopeproof

Turn a product brief into a build plan you can trust. A model drafts the stories. The same checks run in the browser and on the server. A second person signs off. Then the plan is locked.

I built this because it is the part of AI-assisted work I care about most: the model is quick at the first draft, and it is also confident when it is wrong. So I wanted a tool where it is clear what the model wrote, what a person checked, and what nobody can change any more.

## What it does

1. You paste a brief, one requirement per line.
2. You pick a drafter:
   - **Language model.** Any chat API in the OpenAI format (OpenAI, Groq, OpenRouter, a local vLLM). It is off until the server has a key.
   - **Rule drafter.** One story per line, sizes from a keyword table, no model at all. It is the fallback, and a baseline to compare the model against.
   - **Sample draft.** A model-style answer for the tutor brief with 7 common mistakes planted in it, so the demo works without a key.
3. The checks mark what is wrong. Some things block approval, and some are only worth a look.
4. Someone fixes the stories. Then **someone else** approves each one.
5. When every story is approved and nothing blocks, anyone can lock the plan. It gets a fingerprint and can be exported as Markdown.

## Where I trust the model, and where I do not

| The model does | Code checks it | A person decides |
| --- | --- | --- |
| Breaks the brief into stories | The answer must match a strict schema (zod). If it fails, the model gets one retry with the exact errors, and then I give up instead of saving junk | Whether a story is right |
| Writes acceptance criteria | Every story must point to real lines in the brief, so it cannot invent features quietly | Whether a brief line is out of scope, with a written reason |
| Guesses hours | Hours must sit between 0.5 and 40; anything over 16 gets a "split it" warning | The final number |
| Orders the work | Dependencies must exist and must not loop | Approving the plan |

The checks:

| Check | Level | Why |
| --- | --- | --- |
| Story points to no brief line, or to a line that does not exist | must fix | Stops invented scope |
| Story shares no words with the line it points to | worth a look | Catches a wrong reference |
| No acceptance criteria | must fix | Nobody can say when it is done |
| Criterion says "fast", "easy", "intuitive"… with no number | worth a look | It cannot be tested |
| Hours out of range, or very big | must fix / worth a look | Big stories hide surprises |
| Depends on a missing story, on itself, or in a loop | must fix | Nothing on a loop can start |
| Two stories look like the same thing | worth a look | Double counting |
| A brief line has no story and nobody left it out on purpose | must fix | Silent gaps are how projects go over budget |

## Rules the server enforces

- **Nobody approves their own work.** Whoever ran the drafter or last changed a story cannot approve it.
- **Changing a story removes its approval.** An approval is for the exact text someone read.
- **No lost updates.** Every change sends the version the person was looking at. If someone else changed the plan first, the server answers 409 and the screen reloads.
- **A locked plan is read only**, and its fingerprint (a SHA-256 of the brief, the stories and the out-of-scope notes) is in the log and the export.
- **Model calls are limited** to 6 per address per 10 minutes, the brief is capped at 6,000 characters, and the provider's error text never reaches the browser.
- Every action goes into an append-only log that the plan page shows in plain words.

## How it is built

One language from the database to the screen.

- `src/shared` holds the schema and the checks. The React app imports them to show problems while you type, and the server imports the same files before it accepts an approval or a lock.
- `src/server` is Node 22 with Fastify 5 and SQLite (better-sqlite3). Each change runs in one transaction.
- `src/client` is React 19 with Vite. There is no state library; the server sends the whole plan view back after every change, so the screen and the database cannot drift.
- The page polls every 4 seconds, so two people in two tabs see each other's changes, but never while someone is in the middle of an edit.

There is no login. People pick a name, and it goes in an `x-user` header. In a real deployment I would take that from the company's SSO.

## Run it

```bash
npm install
npm run dev        # API on :3990, app on :5173
npm test           # 24 tests
npm run build && npm start
```

To turn on the model drafter:

```bash
AI_API_KEY=... AI_MODEL=gpt-4.1-mini npm start
# any OpenAI-style API: AI_BASE_URL=https://api.groq.com/openai/v1 AI_MODEL=...
```

`render.yaml` deploys it as one free Render web service. The free plan has no disk, so the demo database starts fresh on each deploy.

## Tests

- **Checks:** each rule on its own, loop detection, and the longest chain of hours.
- **Drafters:** a fake model API that sends a broken answer first, to prove the retry gets the exact errors and that two bad answers are refused. Also that the rule drafter covers every line and that the checks catch every planted mistake in the sample.
- **API:** the whole sample from a messy draft to a locked plan, through Fastify's `inject`, plus self-approval, stale versions, approval reset on edit, and deleting a story that others need.

CI runs type checks, tests, a build, and a smoke test of the built server on every push.
