# Contributing

Thanks for wanting to help with Staffless! 🎉

## Development setup

```bash
npm install
npm run dev          # starts in demo mode when no API key is set
npm run typecheck    # TypeScript check
npm run build        # builds the web panel
```

Use `FORCE_MOCK=true` in `.env` to try the flow without a real provider. To run a second instance without touching your main data, set `PORT`, `DATA_DIR` and `WORKSPACE_DIR`.

## Good first contributions

### 1. Add a model
Add an entry to [`config/models.json`](config/models.json):

```json
{
  "key": "openai:new-model",
  "provider": "openai",
  "model": "new-model",
  "label": "New Model",
  "skills": { "planning": 8, "coding": 8, "design": 7, "writing": 8, "review": 8 },
  "speed": 7,
  "price": { "input": 1.0, "output": 4.0 },
  "tags": [],
  "notes": "Short description"
}
```

- `skills` are subjective 1-10 scores. Explain your basis (benchmarks, experience) in the PR.
- `price` is USD per 1M tokens.
- `label` becomes the employee's name, so keep it short and recognisable.
- `tags`: `premium` (not recommended under the balanced priority), `budget`, `local`.

### 2. Add a design
Designs are the easiest contribution and need no code. Create `designs/<id>/` with:
- `DESIGN.md`: frontmatter (`id`, `name`, `description`, `tags`, `best_for`, `fonts`) and the sections Principles, Layout, Typography, Color, Components, Imagery & icons, Motion, Do, Don't. Keep it short and concrete (about 500–800 tokens): models follow rules, not adjectives.
- `tokens.css`: a `:root` block that defines **every** variable listed in `REQUIRED_TOKENS` in `server/designs.ts`. Extra variables are fine.

Rules: original work only (no copies of a real brand's identity), Google Fonts or system fonts only, check text contrast (WCAG AA), and check the preview on the **Designs** page before opening the PR.

### 3. Add a role
1. Add it to the `RoleId` type in `server/types.ts`.
2. Add it to `ROLES` in `server/company/org.ts` with skill weights and a duty description.
3. Add a sample output to `server/providers/mock.ts` so it works in demo mode too.

### 4. Add a provider
Create a file under `server/providers/` that implements the `Provider` interface and register it in `server/providers/index.ts`. If the API has no JSON-schema support, use the `schemaInstruction()` helper.

### 5. Improve the context graph
Extractors live in `server/company/context-graph.ts`. Each one turns a file into `defines`, `uses` and `refs`. New file types, sharper checks (with no false positives) and better selection heuristics are all welcome. Please include a before/after token measurement.

## Guidelines

- Code must pass TypeScript strict mode (`npm run typecheck`).
- Code, comments and UI text are in English. Agents can speak Turkish or English via the language setting.
- Open an issue to discuss large changes first.
- Keep commit messages short and descriptive.
