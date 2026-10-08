# Inline File References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent hand the user a clickable inline reference to any workspace file (`[[file:<path>]]`), which opens in the Workspace tab — or in the Content tab when the path is course material — and let any Workspace file be downloaded.

**Architecture:** A second chip kind reuses the seam `[cite:N]` already uses: `renderFileRefs` runs on the raw markdown before `marked.parse`, emits `<button data-file-path>`, and DOMPurify sanitizes it against the same closed allowlist. One delegated click handler serves both chip kinds; it resolves the path through the existing `resolveRef` and routes a corpus hit to the Content tab and a miss to the Workspace tab. Two tiny pure modules (`refs.ts`) hold the routing and URL-building decisions so they are unit-testable without a DOM.

**Tech Stack:** React 19 + TypeScript + Vite 8, `marked` 18, DOMPurify 3, react-router 7; FastAPI backend (unchanged); `vitest` 5 for the pure string/decision modules only.

**Spec:** `docs/superpowers/specs/2026-10-08-inline-file-references-design.md`

## Global Constraints

- **Client verification** (there is no build in this environment): `cd web && npx tsc -p tsconfig.app.json --tsBuildInfoFile /tmp/tsbuildinfo` must exit 0, and `npx oxlint` must add no new warnings (baseline is 14, all pre-existing).
- `vite build` / `npm run build` cannot run here — `EACCES` on root-owned `node_modules/.tmp` and `node_modules/.vite-temp`. Do not treat its absence as a failure.
- **Python tests** run from the repo root: `.venv/bin/python -m pytest -o addopts=""`.
- **vitest is scoped to pure modules only** — `src/lib/md.ts` and `src/lib/refs.ts`. No component tests, no DOM environment (`environment: 'node'`), no `jsdom`.
- Paths in `[[file:…]]` are **data-root-relative**, the same form `content_read_file`, `extract_file` and the workspace API use.
- `SANITIZE_CONFIG` stays a **closed allowlist**: add `data-file-path` only; `ALLOW_DATA_ATTR` stays `false`.
- **No new API endpoints.** `/api/assets/{rel_path:path}` already serves any file under the data root.
- Never change `[cite:N]` behaviour, `CitationRegistry`, or `resolve_ref`.
- Commit after every task.

## File Structure

| File | Responsibility |
| --- | --- |
| `web/src/lib/md.ts` (modify) | Markdown → HTML. Gains `renderFileRefs` (the marker → chip transform) beside `renderCitations`, and the allowlist entry. |
| `web/src/lib/md.test.ts` (create) | Unit tests for the transform and the allowlist. |
| `web/src/lib/refs.ts` (create) | Pure decisions shared by chat and workspace: where a resolved ref opens (`refTarget`), a workspace deep link (`workspaceHref`), an encoded asset URL (`assetHref`), ancestor dirs for tree expansion (`ancestorDirs`). |
| `web/src/lib/refs.test.ts` (create) | Unit tests for the above. |
| `web/vitest.config.ts` (create) | Minimal vitest config: node environment, `src/**/*.test.ts`. |
| `web/package.json` (modify) | `vitest` devDependency + `test` script. |
| `web/src/chat/ChatView.tsx` (modify) | Click handler gains a `[data-file-path]` branch; `openCitation`'s navigation is extracted into `gotoContent` and reused by `openFileRef`. |
| `web/src/pages/WorkspacePage.tsx` (modify) | Lands on `?path=`, and gains a Download control. |
| `agent/context.py` (modify) | One prompt rule (2c) teaching the marker. |
| `tests/test_mine.py` (modify) | A black-box prompt test beside `test_prompt_teaches_page_addressing`. |
| `tests/test_assets_api.py` (create) | The download path's only server-side dependency: `/api/assets/` serves a workspace file and refuses traversal. |
| `docs/DESIGN.md` (modify) | Documents the two reference kinds for future maintainers. |

---

### Task 1: `renderFileRefs` + vitest

**Files:**
- Modify: `web/src/lib/md.ts` (`renderCitations` is at `:135`, `SANITIZE_CONFIG` at `:176`, `parseMarkdown` at `:185`)
- Create: `web/src/lib/md.test.ts`, `web/vitest.config.ts`
- Modify: `web/package.json`

**Interfaces:**
- Produces: `renderFileRefs(md: string): string` (exported) and `SANITIZE_CONFIG` (exported) from `web/src/lib/md.ts`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Install vitest and wire the config**

Adding a dev-dependency is an install — confirm with the user before running it. `vitest@5` is the version compatible with this repo's `vite@8` (peer range `^6.4.0 || ^7.0.0 || ^8.0.0`) and `@types/node@^24`.

```bash
cd web && npm install -D vitest@^5.0.3
```

Add the script to `web/package.json` (alphabetical among the existing scripts is not required; keep it next to `lint`):

```json
    "lint": "oxlint",
    "test": "vitest run",
```

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

// Scoped to pure modules on purpose: no DOM, no component tests. `md.ts`
// imports katex's CSS, which vitest stubs by default (css: false) — do not
// turn CSS processing on, or node will try to parse a stylesheet.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 2: Write the failing tests**

Create `web/src/lib/md.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { renderFileRefs, SANITIZE_CONFIG } from './md'

describe('renderFileRefs', () => {
  it('turns a file marker into a chip carrying the path', () => {
    const html = renderFileRefs('see [[file:2026F/CS1100A/uploads/slides.pdf]]')
    expect(html).toContain('data-file-path="2026F/CS1100A/uploads/slides.pdf"')
    expect(html).toContain('>slides.pdf</button>')
  })

  it('labels the chip with the basename, not the whole path', () => {
    const html = renderFileRefs('[[file:a/b/c.md]]')
    expect(html).toContain('>c.md</button>')
    expect(html).toContain('title="a/b/c.md"')
  })

  it('leaves a traversal path as literal text', () => {
    const md = '[[file:../../etc/passwd]]'
    expect(renderFileRefs(md)).toBe(md)
  })

  it('leaves a half-typed marker as literal text', () => {
    const md = 'see [[file:abc'
    expect(renderFileRefs(md)).toBe(md)
  })

  it('escapes the path so it cannot break out of the attribute', () => {
    const html = renderFileRefs('[[file:a/"onmouseover=alert(1)]]')
    expect(html).not.toContain('"onmouseover=')
    expect(html).toContain('&quot;')
  })

  it('renders both marker kinds in one message', () => {
    const html = renderFileRefs('a [cite:3] b [[file:x/y.md]]')
    expect(html).toContain('[cite:3]')
    expect(html).toContain('data-file-path="x/y.md"')
  })

  it('leaves an ordinary markdown link alone', () => {
    const md = 'see [docs](https://example.com)'
    expect(renderFileRefs(md)).toBe(md)
  })

  it('allowlists the file-path attribute for the sanitizer', () => {
    // The chip is inert if DOMPurify strips its attribute: the click handler
    // finds nothing and the chip silently does nothing. Cheap guard, no DOM.
    expect(SANITIZE_CONFIG.ADD_ATTR).toContain('data-file-path')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run`
Expected: FAIL — `renderFileRefs is not a function` / no export named `renderFileRefs`.

- [ ] **Step 4: Implement**

In `web/src/lib/md.ts`, add `export` to the existing config declaration:

```ts
export const SANITIZE_CONFIG = {
  ADD_TAGS: ['button'],
  ADD_ATTR: ['data-cite-id', 'data-file-path'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['form', 'input', 'select', 'textarea', 'option'],
}
```

Add `renderFileRefs` immediately after `renderCitations` (which ends at `:148`), reusing the file-local `escapeHtml` (`:109`):

```ts
/**
 * Replace [[file:<data-root-relative path>]] with inline chips.
 *
 * Same seam as renderCitations: this runs on the RAW markdown, before
 * marked.parse, so the chip markup is injected as inline HTML and then
 * sanitized. `marked` does not treat [[…]] as a link (verified against
 * marked 18: `**[[file:x.md]]**` parses to <strong>[[file:x.md]]</strong>),
 * so the marker survives parsing intact.
 *
 * Unlike a citation, the path is written by the model rather than minted
 * server-side — that is the point (it can reference a file it only saw
 * listed), and it is why a path that tries to climb out of the data root is
 * left as literal text instead of becoming a control that cannot work.
 */
export function renderFileRefs(md: string): string {
  if (!/\[\[file:[^\]]+\]\]/.test(md)) return md
  return md.replace(/\[\[file:([^\]]+)\]\]/g, (marker, raw: string) => {
    const path = raw.trim()
    if (!path || path.split('/').includes('..')) return marker
    const label = escapeHtml(path.split('/').pop() || path)
    const attr = escapeHtml(path)
    return `<button type="button" class="file-chip" data-file-path="${attr}" title="${attr}">${label}</button>`
  })
}
```

Wire it into `parseMarkdown` (`:185`):

```ts
export function parseMarkdown(content: string, citations?: Record<number, CitationMeta>): string {
  const body = renderFileRefs(renderCitations(content ?? '', citations))
  const html = (marked.parse(balanceFences(renderFootnotes(body))) as string) || ''
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run`
Expected: PASS — 8 passed.

- [ ] **Step 6: Verify types and lint**

Run: `cd web && npx tsc -p tsconfig.app.json --tsBuildInfoFile /tmp/tsbuildinfo && npx oxlint`
Expected: tsc exit 0; oxlint still 14 warnings, none in `md.ts` or `md.test.ts`.

Note: `tsconfig.app.json` may not include `*.test.ts`; if `tsc` reports the new test file as untyped/unused, add it to the `include` list rather than excluding it.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/lib/md.ts web/src/lib/md.test.ts
git commit -m "feat(web): render [[file:path]] markers as chips; add vitest for md.ts"
```

---

### Task 2: `refs.ts` decisions + chat click routing

**Files:**
- Create: `web/src/lib/refs.ts`, `web/src/lib/refs.test.ts`
- Modify: `web/src/chat/ChatView.tsx` (`openCitation` at `:526`, `onCitationClick` at `:551`)

**Interfaces:**
- Consumes: nothing from Task 1 (independent modules).
- Produces from `web/src/lib/refs.ts`:
  - `interface ResolvedRef { kind: string; courseId: number; nodeId?: number; fileId?: number; ref?: string; isPdf?: boolean }`
  - `type RefTarget = { kind: 'content'; fileId?: number; nodeId?: number } | { kind: 'workspace' }`
  - `refTarget(resolved: ResolvedRef | null): RefTarget`
  - `workspaceHref(courseId: number, path: string): string`
  - `ancestorDirs(path: string): string[]`
  - `assetHref(path: string): string`

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/refs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { ancestorDirs, assetHref, refTarget, workspaceHref } from './refs'

describe('refTarget', () => {
  it('routes a resolved corpus file to the content tab', () => {
    expect(refTarget({ kind: 'file', courseId: 1, fileId: 7, nodeId: 3 }))
      .toEqual({ kind: 'content', fileId: 7, nodeId: 3 })
  })

  it('routes a node-only hit to the content tab', () => {
    expect(refTarget({ kind: 'overview', courseId: 1, nodeId: 9 }))
      .toEqual({ kind: 'content', fileId: undefined, nodeId: 9 })
  })

  it('routes an unresolved path to the workspace', () => {
    // api.resolveRef THROWS (404) for a workspace path; the caller catches and
    // passes null. That null is the workspace case, not an error.
    expect(refTarget(null)).toEqual({ kind: 'workspace' })
  })

  it('treats a hit with no ids as a workspace path', () => {
    expect(refTarget({ kind: 'file', courseId: 1 })).toEqual({ kind: 'workspace' })
  })
})

describe('workspaceHref', () => {
  it('encodes the path into the query string', () => {
    expect(workspaceHref(4, 'uploads/a b#c.md'))
      .toBe('/courses/4/workspace?path=uploads%2Fa%20b%23c.md')
  })
})

describe('ancestorDirs', () => {
  it('lists the directories a file sits under, shallowest first', () => {
    expect(ancestorDirs('uploads/sub/deep.md')).toEqual(['uploads', 'uploads/sub'])
  })

  it('returns nothing for a top-level file', () => {
    expect(ancestorDirs('syllabus.md')).toEqual([])
  })
})

describe('assetHref', () => {
  it('encodes each segment but keeps the separators', () => {
    // The route is /api/assets/{rel_path:path} — a %2F would break routing.
    expect(assetHref('2026F/CS1100A/content/Course Overview/a#b.pdf'))
      .toBe('/api/assets/2026F/CS1100A/content/Course%20Overview/a%23b.pdf')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/lib/refs.test.ts`
Expected: FAIL — cannot resolve `./refs`.

- [ ] **Step 3: Implement `web/src/lib/refs.ts`**

```ts
/**
 * Pure decisions behind an inline file reference. Kept out of the components
 * so they can be unit-tested without a DOM: which tab a resolved reference
 * opens, and how the two URLs are built.
 */

/** Shape returned by `api.resolveRef` (mirrors api/routers/courses.py:166). */
export interface ResolvedRef {
  kind: string
  courseId: number
  nodeId?: number
  fileId?: number
  ref?: string
  isPdf?: boolean
}

export type RefTarget =
  | { kind: 'content'; fileId?: number; nodeId?: number }
  | { kind: 'workspace' }

/**
 * Where a reference should open. A corpus hit — anything resolve_ref could
 * map to a file or a node — goes to the Content tab, which knows how to show
 * a PDF page, an assignment or a module. Everything else is a workspace path.
 *
 * `null` is the normal workspace case, not a failure: `resolveRef` throws a
 * 404 for a path that is not in the corpus, and the caller passes null.
 */
export function refTarget(resolved: ResolvedRef | null): RefTarget {
  if (resolved && (resolved.fileId != null || resolved.nodeId != null)) {
    return { kind: 'content', fileId: resolved.fileId, nodeId: resolved.nodeId }
  }
  return { kind: 'workspace' }
}

/** Deep link that selects a file in the Workspace tab. */
export function workspaceHref(courseId: number, path: string): string {
  return `/courses/${courseId}/workspace?path=${encodeURIComponent(path)}`
}

/** Directories a workspace path sits under, shallowest first — for expanding
 *  the tree so the selected file is visible. */
export function ancestorDirs(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/**
 * URL for a file under the data root. Segments are encoded but the `/`
 * separators are kept: the route is `/api/assets/{rel_path:path}`, so an
 * encoded separator would not match. Without this, a filename containing `#`
 * or `?` produces a broken link (services.workspace_read interpolates the raw
 * path into the URL it returns).
 */
export function assetHref(path: string): string {
  return `/api/assets/${path.split('/').map(encodeURIComponent).join('/')}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/lib/refs.test.ts`
Expected: PASS — 8 passed.

- [ ] **Step 5: Refactor `openCitation`'s navigation into `gotoContent`**

In `web/src/chat/ChatView.tsx`, add the import beside the existing `@/lib/...` imports:

```ts
import { refTarget, workspaceHref, type ResolvedRef } from "@/lib/refs";
```

Replace the body of `openCitation` (currently `:526-582`) so the navigation half becomes its own callback. Keep the existing comments and behaviour exactly — this is a pure extraction:

```ts
	/** Navigate to a resolved content target. Shared by both chip kinds: a
	 *  citation always lands here, and a file reference lands here when its
	 *  path turns out to be course material. */
	const gotoContent = useCallback(
		(cid: number, nodeId?: number, fileId?: number, page?: number) => {
			// If the PDF is already open, jump immediately (even when route unchanged).
			window.dispatchEvent(
				new CustomEvent("campus:goto-citation", {
					detail: { courseId: cid, nodeId, fileId, page },
				}),
			);

			if (nodeId != null) {
				const q = new URLSearchParams();
				if (fileId != null) q.set("file", String(fileId));
				if (page != null) q.set("page", String(page));
				const qs = q.toString();
				navigate(
					`/courses/${cid}/content/${nodeId}${qs ? `?${qs}` : ""}`,
				);
				return;
			}

			if (fileId != null) {
				const q = new URLSearchParams({ file: String(fileId) });
				if (page != null) q.set("page", String(page));
				navigate(`/courses/${cid}/content?${q.toString()}`);
			}
		},
		[navigate],
	);

	const openCitation = useCallback(
		async (citeId: number, cites?: Citation[]) => {
			const c = cites?.find((x) => x.id === citeId);
			if (!c) return;
			const cid = c.courseId ?? courseId;
			if (!cid) return;

			let nodeId = c.nodeId ?? undefined;
			let fileId = c.fileId ?? undefined;

			if (!nodeId || !fileId) {
				try {
					const resolved = await api.resolveRef(cid, c.ref);
					nodeId = resolved.nodeId ?? nodeId;
					fileId = resolved.fileId ?? fileId;
				} catch {
					// fall through with what we have
				}
			}

			const page = c.page != null && c.page > 0 ? c.page : undefined;
			gotoContent(cid, nodeId, fileId, page);
		},
		[courseId, gotoContent],
	);
```

- [ ] **Step 6: Add `openFileRef` and the click branch**

Immediately after `openCitation`:

```ts
	/** Open a [[file:path]] reference. A path that resolves in the corpus is
	 *  served by the richer Content viewer; anything else is a workspace file,
	 *  so it opens in the Workspace tab with the file selected. */
	const openFileRef = useCallback(
		async (path: string) => {
			const cid = courseId;
			if (!cid) return;
			let resolved: ResolvedRef | null = null;
			try {
				resolved = await api.resolveRef(cid, path);
			} catch {
				// 404 for a workspace path — expected, not an error.
				resolved = null;
			}
			const target = refTarget(resolved);
			if (target.kind === "content") {
				gotoContent(cid, target.nodeId, target.fileId);
				return;
			}
			navigate(workspaceHref(cid, path));
		},
		[courseId, gotoContent, navigate],
	);
```

Replace `onCitationClick` (currently `:551-565`) with a version handling both kinds:

```ts
	const onCitationClick = useCallback(
		(e: { target: EventTarget | null; preventDefault: () => void }, cites?: Citation[]) => {
			const el = e.target as HTMLElement;

			const citeBtn = el.closest<HTMLElement>("[data-cite-id]");
			if (citeBtn) {
				e.preventDefault();
				const id = Number(citeBtn.dataset.citeId);
				if (Number.isFinite(id)) void openCitation(id, cites);
				return;
			}

			const fileBtn = el.closest<HTMLElement>("[data-file-path]");
			if (fileBtn) {
				e.preventDefault();
				const path = fileBtn.dataset.filePath;
				if (path) void openFileRef(path);
			}
		},
		[openCitation, openFileRef],
	);
```

The call site at `:968` (`onClick={(e) => onCitationClick(e, mergedCitesByNode.get(node.id) ?? node.citations)}`) is unchanged — it is already a delegated handler on the message container.

- [ ] **Step 7: Verify types and lint**

Run: `cd web && npx tsc -p tsconfig.app.json --tsBuildInfoFile /tmp/tsbuildinfo && npx oxlint`
Expected: tsc exit 0; oxlint 14 warnings (baseline).

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/refs.ts web/src/lib/refs.test.ts web/src/chat/ChatView.tsx
git commit -m "feat(web): route [[file:path]] clicks to workspace or content"
```

---

### Task 3: Workspace landing on `?path=` + download

**Files:**
- Modify: `web/src/pages/WorkspacePage.tsx` (`assetUrl` state at `:40`, `openNode` at `:164`, the binary link at `:509`, the editor header at `:~470`)
- Create: `tests/test_assets_api.py`

**Interfaces:**
- Consumes from Task 2: `ancestorDirs(path)`, `assetHref(path)` from `@/lib/refs`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing Python test for the download path**

The Download control depends on `/api/assets/` serving a workspace file. That is the only server-side dependency in this feature, so it gets a test even though no server code changes.

Create `tests/test_assets_api.py`:

```python
"""GET /api/assets/{path} is the download path for workspace files.

No server change accompanies this feature — the route already serves anything
under the data root — but the new Download control depends on it, so pin the
two properties that matter: it serves a workspace upload, and it cannot be
walked out of the data root.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent


@pytest.fixture()
def asset_env(tmp_path: Path, monkeypatch):
    db = tmp_path / "harness.db"
    root = tmp_path / "school"
    conn = sqlite3.connect(db)
    conn.executescript((REPO / "schema.sql").read_text())
    conn.execute("INSERT INTO courses (code,name,term) VALUES (?,?,?)",
                 ("CS 1100A", "Introduction to Programming", "2026F"))
    conn.commit()
    conn.close()

    import api.config as _cfg
    import api.db as _db
    import api.services as _svc
    monkeypatch.setattr(_cfg, "DB_PATH", db)
    monkeypatch.setattr(_db, "DB_PATH", db)
    monkeypatch.setattr(_svc, "SCHOOL_ROOT", root)

    up = root / "2026F" / "CS1100A" / "uploads"
    up.mkdir(parents=True)
    (up / "notes.txt").write_text("hello from the workspace")
    return root


def _client():
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


def test_asset_route_serves_a_workspace_upload(asset_env):
    r = _client().get("/api/assets/2026F/CS1100A/uploads/notes.txt")
    assert r.status_code == 200
    assert r.text == "hello from the workspace"


def test_asset_route_serves_a_path_with_spaces(asset_env):
    d = asset_env / "2026F" / "CS1100A" / "content" / "Course Overview"
    d.mkdir(parents=True)
    (d / "outline.md").write_text("outline")
    r = _client().get("/api/assets/2026F/CS1100A/content/Course%20Overview/outline.md")
    assert r.status_code == 200
    assert r.text == "outline"


def test_asset_route_refuses_traversal(asset_env):
    # Encoded so the client does not normalise it away before it is sent.
    r = _client().get("/api/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd")
    assert r.status_code in (400, 403, 404)
    assert "root:" not in r.text
```

- [ ] **Step 2: Run it to verify it passes (no implementation needed)**

Run: `.venv/bin/python -m pytest tests/test_assets_api.py -o addopts="" -v`
Expected: PASS — 3 passed. If `test_asset_route_serves_a_path_with_spaces` fails, the route is not decoding the path as expected and Task 3's `assetHref` must be revisited before continuing.

- [ ] **Step 3: Land on `?path=`**

In `web/src/pages/WorkspacePage.tsx`, extend the react-router import (currently `import { useParams } from 'react-router-dom'`):

```ts
import { useParams, useSearchParams } from 'react-router-dom'
```

Add the refs import beside the other `@/lib/...` imports:

```ts
import { ancestorDirs, assetHref } from '@/lib/refs'
```

Add, after the existing `openNode` definition (`:~190`):

```tsx
  // A [[file:path]] chip deep-links here as /workspace?path=… . Select the file
  // once the tree is loaded — the tree arrives asynchronously, so this cannot
  // run on mount alone. The guard is the CURRENTLY OPEN path, not "have we seen
  // this param": clicking the same chip twice, after opening something else,
  // must re-select it.
  const [searchParams] = useSearchParams()
  const pathParam = searchParams.get('path')
  useEffect(() => {
    if (!pathParam || !tree) return
    if (openPathRef.current === pathParam) return
    const node = findNode(tree.nodes, pathParam)
    if (!node || node.type !== 'file') {
      setNotice("That file isn't in this workspace.")
      return
    }
    setOpenDirs((prev) => {
      const next = new Set(prev)
      for (const d of ancestorDirs(pathParam)) next.add(d)
      return next
    })
    void openNode(node)
  }, [pathParam, tree, findNode, openNode])
```

If the effect re-runs endlessly, the cause is `findNode`/`openNode` changing identity each render — the `openPathRef` guard should already stop it; if not, wrap `findNode` in `useCallback` rather than adding a suppression comment.

- [ ] **Step 4: Add the Download control and fix the unencoded viewer link**

The editor header has this block (`:~470`):

```tsx
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {current.writable && isText && (
```

Add the download link as the first child of that div:

```tsx
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <a
                  className="icon-btn"
                  href={assetHref(current.path)}
                  download={current.name}
                  title="Download this file"
                  aria-label="Download this file"
                >
                  <Download size={12} />
                </a>
                {current.writable && isText && (
```

Add `Download` to the existing `lucide-react` import list.

Then replace the raw `href={assetUrl}` on the binary viewer link (`:510`) so it is encoded:

```tsx
            {assetUrl ? (
              <a className="empty compact" style={{ margin: 'auto', textDecoration: 'none' }} href={assetHref(current!.path)} target="_blank" rel="noreferrer noopener">
```

`assetUrl` keeps its existing job — selecting this branch — and is **not** reused for the download href, because setting it for text files would replace the rendered view with a link.

- [ ] **Step 5: Verify types and lint**

Run: `cd web && npx tsc -p tsconfig.app.json --tsBuildInfoFile /tmp/tsbuildinfo && npx oxlint`
Expected: tsc exit 0; oxlint 14 warnings (baseline) — if `current!` trips a lint rule, restructure the branch to narrow `current` instead of asserting.

- [ ] **Step 6: Run the Python suite**

Run: `.venv/bin/python -m pytest -o addopts=""`
Expected: PASS — the previous total plus 3.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/WorkspacePage.tsx tests/test_assets_api.py
git commit -m "feat(web): workspace ?path= landing + download control"
```

---

### Task 4: Teach the marker and document it

**Files:**
- Modify: `agent/context.py` (rules block, `build_system_prompt` at `:125`; the citation rules are at `:168-179`)
- Modify: `tests/test_mine.py` (append after `test_prompt_teaches_page_addressing` at `:942`)
- Modify: `docs/DESIGN.md` (insert after the "Agent tools (v1)" list, before "### UI direction")

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing prompt test**

Append to `tests/test_mine.py`, mirroring `test_prompt_teaches_page_addressing` — black-box, built from that module's own `cfg`/`db` fixtures:

```python
def test_prompt_teaches_workspace_file_references(cfg, db):
    """A workspace file is not a citation: the model must know the marker,
    or it will cite a path that resolve_ref cannot resolve."""
    from agent.context import build_system_prompt

    prompt = build_system_prompt(cfg, db, None)
    assert "[[file:" in prompt, "prompt must teach the [[file:path]] marker"
    assert "uploads/" in prompt, "prompt must name the workspace dirs"
    assert "notes/" in prompt and "work/" in prompt
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_prompt_teaches_workspace_file_references -o addopts="" -v`
Expected: FAIL — `assert '[[file:' in prompt`.

- [ ] **Step 3: Add the rule**

In `agent/context.py`, insert rule `2c` after rule `2b` (keeping the existing 2/2b/3 numbering):

```text
2c. A file in the workspace (anything under uploads/, notes/ or work/ — including
    a file you just wrote) is NOT a citation. Reference it as
    [[file:<path relative to data_root>]], copying the exact path from the tool
    result: [[file:2026F/CS1100A/notes/2026-10-08-outline.md]]. The user clicks
    it to open the file. Use [cite:N] for course material (lecture files,
    assignments, announcements, modules) and [[file:…]] only for workspace files.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_mine.py -o addopts="" -v`
Expected: PASS, including the pre-existing prompt tests (this changes prompt text, and prefix caching means the rule must stay in the static leading block — `2c` sits inside the RULES list, which is already in that block).

- [ ] **Step 5: Document the two kinds**

In `docs/DESIGN.md`, insert between the "Agent tools (v1)" bullet list and `### UI direction`:

```markdown
### Inline references

Two kinds, split by what they point at:

| Marker | Points at | Opens |
| --- | --- | --- |
| `[cite:N]` | course material (files, announcements, modules) | Content tab — PDF page, node |
| `[[file:<data-root-relative path>]]` | a workspace file (`uploads/`, `notes/`, `work/`) | Workspace tab, file selected |

`[cite:N]` ids are minted server-side (`CitationRegistry`), so the model can
only cite material it actually read. `[[file:…]]` is written directly by the
model, so it can reference any path it can name; a path that resolves in the
corpus routes to the Content tab anyway, so a wrong choice still lands
somewhere sensible.
```

- [ ] **Step 6: Run the full suite**

Run: `.venv/bin/python -m pytest -o addopts=""`
Expected: PASS — the previous total plus 1.

- [ ] **Step 7: Commit**

```bash
git add agent/context.py tests/test_mine.py docs/DESIGN.md
git commit -m "feat(agent): teach [[file:path]] workspace references"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| Reference syntax `[[file:path]]`, `..` refusal, basename label, streaming | 1 |
| Rendering seam + `data-file-path` allowlist | 1 |
| Click routing: corpus → Content, miss → Workspace | 2 |
| `?path=` landing, ancestor expansion, missing-file notice | 3 |
| Download control + encoded asset URL | 3 |
| Prompt rule | 4 |
| Docs | 4 |
| Error-handling table (missing file, traversal, half-typed, tree-loading race) | 1 (traversal, half-typed), 3 (missing, race) |
| Security: escaping, closed allowlist, no new endpoints | 1, 3 |
| Testing: vitest for pure modules, Python asset test | 1, 2, 3, 4 |

No spec requirement is left without a task.

**Placeholder scan:** every step carries real code or a real command; no "handle edge cases", no "similar to Task N".

**Type consistency:** `renderFileRefs(md: string): string` and `SANITIZE_CONFIG` are used with the same names in Tasks 1–2; `ResolvedRef` / `RefTarget` / `refTarget` / `workspaceHref` / `ancestorDirs` / `assetHref` are defined once in Task 2 and consumed with identical signatures in Task 3; `data-file-path` is spelled the same in `md.ts`, `SANITIZE_CONFIG` and `ChatView.tsx`.

**Known gaps, deliberate:** component wiring (the delegated click, the `?path=` effect, the download control) has no automated test — this repo has no component-test setup and the plan does not add one. Those four behaviours need a manual browser check, listed here so the gap is explicit rather than implied.
