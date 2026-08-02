from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api import services

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.get("/status")
def sync_status():
    return services.latest_sync_status()


@router.get("/runs")
def sync_runs(limit: int = 20):
    return services.list_sync_runs(limit=limit)


@router.get("/runs/{run_id}")
def sync_run(run_id: int):
    run = services.get_sync_run(run_id)
    if not run:
        raise HTTPException(404, "Sync run not found")
    return run


@router.get("/runs/{run_id}/log")
def sync_log(run_id: int):
    if not services.get_sync_run(run_id):
        raise HTTPException(404, "Sync run not found")
    return {"markdown": services.get_sync_log(run_id)}


@router.post("/trigger")
def trigger_sync(course_id: int | None = None):
    return services.trigger_sync(course_id=course_id)
