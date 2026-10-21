"""Corpus search and the index rebuild.

GET /api/search ranks the indexed chunks; the agent reaches the same ranker
through its search_corpus tool, and this route is what the UI, scripts and the
no-model demo use.

Enabling semantic search only takes effect after the index is rebuilt —
sync.search.rebuild is incremental, so repeat runs are cheap.

Mirrors the sync trigger's shape (api/services.py::trigger_sync): a
module-level lock, an atomic check-and-set, a daemon thread, and a status the
UI can poll. Status is in-process and lost on restart, like the sync trigger's.
"""
from __future__ import annotations

import datetime
import logging
import threading

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/search", tags=["search"])

_lock = threading.Lock()
_state: dict = {"status": "idle", "result": None, "error": None,
                "finished_at": None}


def _finish(**kw) -> None:
    with _lock:
        _state.update(**kw)


@router.get("")
def search_corpus(
    q: str = Query(..., min_length=1, description="query text"),
    course_id: int | None = None,
    top_k: int = Query(8, ge=1, le=50),
):
    """Ranked hits over the synced corpus.

    Works in lexical mode, so it needs no embedding or rerank model.
    """
    from api import services

    return services.search_corpus(q, course_id=course_id, top_k=top_k)


@router.post("/rebuild")
def rebuild_index():
    from api import services

    with _lock:
        if _state["status"] == "running":
            return {"status": "running"}
        if services.sync_in_progress():
            # Both write `chunks`; a rebuild during a sync is wasted work.
            return {"status": "sync_running"}
        _state.update(status="running", result=None, error=None, finished_at=None)

    def _run() -> None:
        db = None
        try:
            from sync.config import Config
            from sync.db import DB
            from sync.search import rebuild

            cfg = Config.load()
            db = DB(cfg.db_path)
            result = rebuild(cfg, db)
            _finish(status="done", result=result,
                    finished_at=datetime.datetime.now().isoformat(timespec="seconds"))
        except Exception as e:
            logging.exception("[search] background rebuild failed")
            _finish(status="error", error=str(e),
                    finished_at=datetime.datetime.now().isoformat(timespec="seconds"))
        finally:
            if db is not None:
                db.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}


@router.get("/rebuild/status")
def rebuild_status():
    from api import services
    from sync.config import Config

    with _lock:
        state = dict(_state)
    state["index"] = services.search_index_summary(Config.load())
    return state
