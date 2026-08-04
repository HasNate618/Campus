# Campus — Skills (consolidated, in-repo)

This directory holds the full operational knowledge for the Campus project
(previously HippoCampus). It was consolidated here on 2026-08-04 from the
Hermes homelab profile's campus-specific skills (`campus`,
`campus-school-harness`, `campus-web-ui`) so the knowledge is versioned
WITH the code instead of living only in agent profile skills.

The homelab profile keeps ONE pointer skill (`campus`) that points here.

## Index

| File | Covers |
|------|--------|
| [campus-operations.md](campus-operations.md) | Repo/remote, commands (auth/sync/extract), architecture map, model config, services, container deployment, deploy/verify recipe, PWA+HTTPS, phase status, ops pitfalls |
| [campus-harness.md](campus-harness.md) | The AI agent harness (the product): context construction, tool registry, tool-calling loop, memory card, design rules, harness pitfalls |
| [campus-web-ui.md](campus-web-ui.md) | Frontend (web/ React PWA): build/deploy/verify loop, Nate's UI expectations, chat message-tree bug classes, data shapes, verification habits |
| [campus-setup.md](campus-setup.md) | Fresh-clone bootstrap (seed-before-sync, env contract, secrets hygiene, no-migration schema evolution) |
| [references/](references/) | 16 deep-dive reference docs (verbatim from the skills) — D2L API, SSO, pdf-extractor API, content auth proxy, chat-v2 architecture, frontend patterns, zen-pdf pipeline, debugging, setup audit, etc. |
| [scripts/](scripts/) | `stream_probe.py` — Playwright streaming probe (run inside the container) |
| [archive/](archive/) | The original four SKILL.md bodies, verbatim, for zero-loss archaeology |

## Canonical repo docs (older, still valid)

`docs/DESIGN.md` (architecture) · `docs/HANDOFF.md` (implementer brief) ·
`docs/DATA_MODEL.md` (schema) · `docs/BUILD_PLAN.md` (phases 0–5) ·
`docs/PLAN.md` · `docs/chat-v2-plan.md` (chat v2 design, committed 2026-08-03).

## How to use

- **Sync/auth/deploy/verify** → campus-operations.md
- **Agent harness / tools / memory** → campus-harness.md
- **Any web/ UI change or chat/render bug** → campus-web-ui.md
- **Deep dive on one subsystem** → the matching file in references/
- **"Did something get lost in the consolidation?"** → archive/ has the raw originals.

## Golden rules (from the skills, restated)

- The **agent harness is the product**, not the UI.
- **Sync is dumb** (deterministic fetch/diff/store) — the AI digest and agent
  are the intelligence layer over SQLite + files. Chat NEVER calls
  Brightspace live.
- All AI mutations go through audited paths (`audit_log`, before/after JSON).
- Secrets and course content never go in git.
- **Push after every commit** (`git push github main`) — a local-only repo is
  one crash away from history loss.
- `memory_facts` supersede (`is_active=0`), never delete.
- Commit identity: `git -c user.name='Nathan Espejo' -c
  user.email='nate.e.espejo@gmail.com'` — pass inline, don't rely on a
  repo-local gitconfig.
