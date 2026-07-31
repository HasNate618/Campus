-- school-harness schema — SQLite
-- Source of truth for structured school data. Everything the AI can read
-- and update lives here. All AI/automation mutations go through audit_log.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Courses ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    code                    TEXT NOT NULL UNIQUE,        -- 'SE 3309A'
    name                    TEXT NOT NULL,               -- 'Database Management Systems'
    term                    TEXT NOT NULL,               -- '2026F' | '2027W'
    instructor              TEXT,                        -- last known instructor
    units                   REAL,                        -- 0.50
    class_nbr               TEXT,                        -- registrar class number
    brightspace_org_unit_id INTEGER,                     -- set by sync
    brightspace_url         TEXT,
    color                   TEXT,                        -- UI accent
    syllabus_path           TEXT,                        -- local markdown path
    notes                   TEXT,
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scheduled class meetings (LEC/LAB/TUT) — from registrar, AI-verifiable
CREATE TABLE IF NOT EXISTS course_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('LEC','LAB','TUT')),
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Mon
    start_time  TEXT NOT NULL,                           -- '11:30'
    end_time    TEXT NOT NULL,
    room        TEXT,
    section     TEXT
);

-- ── Academic work ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    due_at      TEXT,                                    -- ISO 8601 local
    weight      REAL,                                    -- % of final grade
    status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_progress','submitted','graded','extended')),
    source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('brightspace','manual','ai','seed')),
    brightspace_folder_id INTEGER,                       -- for submission sync
    url         TEXT,
    notes       TEXT,                                    -- AI/user annotations (extensions etc)
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,                           -- 'Midterm 1', 'Final'
    starts_at   TEXT,
    ends_at     TEXT,
    room        TEXT,
    weight      REAL,
    notes       TEXT,
    source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('brightspace','manual','ai')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Content / lectures ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lectures (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    date            TEXT NOT NULL,                       -- YYYY-MM-DD
    title           TEXT,
    topic           TEXT,                                -- AI-summarized topic
    summary         TEXT,                                -- AI digest (markdown)
    key_points      TEXT,                                -- AI-extracted bullets (markdown)
    slides_path     TEXT,                                -- local pdf/md path
    transcript_path TEXT,                                -- local markdown transcript
    recording_path  TEXT,                                -- audio file
    recording_status TEXT NOT NULL DEFAULT 'none'
                     CHECK (recording_status IN ('none','uploaded','transcribing','transcribed','failed')),
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','attended','missed','cancelled')),
    source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('brightspace','recording','manual','ai')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Files synced from Brightspace / recordings / notes (content-addressed)
CREATE TABLE IF NOT EXISTS files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    path        TEXT NOT NULL UNIQUE,                    -- relative to course dir
    kind        TEXT NOT NULL DEFAULT 'other'
                CHECK (kind IN ('slide','reading','handout','assignment','recording','transcript','note','other')),
    source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('brightspace','recording','onedrive','manual')),
    sha256      TEXT,                                    -- dedupe / change detection
    size        INTEGER,
    synced_at   TEXT,
    processed   INTEGER NOT NULL DEFAULT 0,              -- 1 = markdown extracted/indexed
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Announcements + news ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT,                                    -- markdown
    author      TEXT,
    posted_at   TEXT,
    is_pinned   INTEGER NOT NULL DEFAULT 0,
    brightspace_id INTEGER,                              -- dedupe
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Notes (user + AI) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER REFERENCES courses(id) ON DELETE CASCADE, -- NULL = general
    title       TEXT NOT NULL,
    body_md     TEXT NOT NULL DEFAULT '',
    tags        TEXT,                                    -- comma-separated
    source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual','ai','lecture','sync')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── AI-extracted durable facts ("memory") ──────────────────────────────
-- The AI writes small verifiable facts here after every sync/lecture.
-- Unified memory: course_id NULL = cross-course fact.
CREATE TABLE IF NOT EXISTS memory_facts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER REFERENCES courses(id) ON DELETE CASCADE, -- NULL = general
    fact        TEXT NOT NULL,                            -- single-sentence fact
    category    TEXT NOT NULL DEFAULT 'general'
                CHECK (category IN ('general','scheduling','grading','course-policy',
                                    'prof-note','exam','assignment','logistics')),
    confidence  REAL NOT NULL DEFAULT 0.5,                -- AI self-assessed
    source      TEXT NOT NULL,                            -- 'sync:2026-09-10', 'lecture:2026-09-12', 'user'
    is_active   INTEGER NOT NULL DEFAULT 1,               -- soft delete / superseded
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Calendar events (ICS-exportable) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('class','assignment','exam','personal')),
    title       TEXT NOT NULL,
    starts_at   TEXT NOT NULL,
    ends_at     TEXT,
    all_day     INTEGER NOT NULL DEFAULT 0,
    notes       TEXT,
    ics_uid     TEXT UNIQUE,                              -- stable across regenerations
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Sync audit ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','ok','partial','failed')),
    trigger         TEXT NOT NULL DEFAULT 'manual'
                    CHECK (trigger IN ('manual','cron','api')),
    courses_processed INTEGER NOT NULL DEFAULT 0,
    files_new       INTEGER NOT NULL DEFAULT 0,
    files_changed   INTEGER NOT NULL DEFAULT 0,
    announcements_new INTEGER NOT NULL DEFAULT 0,
    facts_added     INTEGER NOT NULL DEFAULT 0,
    log_path        TEXT,                                 -- AI-generated sync log (markdown)
    error           TEXT
);

-- Every mutation by AI/user tooling — reversible + auditable
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL DEFAULT (datetime('now')),
    actor       TEXT NOT NULL CHECK (actor IN ('system','ai','user','sync')),
    entity      TEXT NOT NULL,                            -- 'assignment', 'memory_facts'...
    entity_id   INTEGER,
    action      TEXT NOT NULL,                            -- 'create','update','extend','note'
    detail      TEXT                                      -- JSON before/after
);

CREATE INDEX IF NOT EXISTS idx_assignments_due ON assignments(due_at);
CREATE INDEX IF NOT EXISTS idx_lectures_course_date ON lectures(course_id, date);
CREATE INDEX IF NOT EXISTS idx_memory_course ON memory_facts(course_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(starts_at);
