from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from api import services

router = APIRouter(prefix="/api", tags=["data"])


@router.get("/announcements")
def announcements(course_id: int | None = None, limit: int = Query(20, le=100)):
    return services.list_announcements(course_id=course_id, limit=limit)


@router.get("/events")
def events(
    course_id: int | None = None,
    from_dt: str | None = None,
    to_dt: str | None = None,
):
    return services.list_events(course_id=course_id, from_dt=from_dt, to_dt=to_dt)


@router.get("/events/next-7-days")
def events_next_7(course_id: int | None = None):
    return services.events_next_days(7, course_id=course_id)


@router.get("/files/{file_id}")
def get_file(file_id: int):
    f = services.get_file(file_id)
    if not f:
        raise HTTPException(404, "File not found")
    return f


@router.get("/files/{file_id}/content")
def file_content(file_id: int):
    content = services.get_file_content(file_id)
    if content is None:
        raise HTTPException(404, "File not found")
    return content


@router.get("/files/{file_id}/raw")
def file_raw(file_id: int):
    """Raw bytes (PDFs for pdf.js). Path-guarded to SCHOOL_ROOT."""
    from fastapi.responses import FileResponse
    p = services.get_file_raw_path(file_id)
    if not p:
        raise HTTPException(404, "File not found")
    if p.resolve().is_relative_to(services.SCHOOL_ROOT.resolve()):
        return FileResponse(p)
    raise HTTPException(403, "Forbidden")
