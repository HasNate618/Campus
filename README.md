# School Harness (HippoCampus)

Personal AI study/org system for Western SE. Brightspace sync, structured
memory, calendar, files, and chat — see **`docs/DESIGN.md`**.

Implementers on `home`: start at **`docs/HANDOFF.md`**.

## Layout

```
schema.sql          SQLite schema (SoT for structured data)
seed/               registrar + SE 2250B pilot seed
docs/DESIGN.md      architecture (canonical)
docs/HANDOFF.md     implementer handoff + reconverge gates
docs/DATA_MODEL.md  tables + write rules
docs/PLAN.md        older notes (superseded by DESIGN.md)
data/               SQLite DB (gitignored)
school/             synced content (gitignored; /srv in prod)
```

## Quick start

```bash
python3 seed/seed.py --reset   # create DB + seed courses (needs sqlite-enabled python)
```

On `home`, the default `python3` may be minimal (no `_sqlite3`). Use a full interpreter, e.g. `nix-shell -p python3 --run "python3 seed/seed.py --reset"`, or whatever full Python you already use for services.

## Rules

- Course content NEVER goes in git (see `.gitignore`)
- Every AI mutation is audited (`audit_log`) — reversible by design
- Brightspace sync is on-demand (Duo 2FA) — no background scraping
- Brightspace MCP is not a runtime dependency — custom sync only
