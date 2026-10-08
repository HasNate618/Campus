from __future__ import annotations

import asyncio
import errno

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from api import services

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.get("")
def list_courses(active_only: bool = True):
    return services.list_courses(active_only=active_only)


@router.get("/schedule")
def schedule():
    """Weekly timetable in the ScheduleCourse[] contract (web/src/types.ts)."""
    return services.get_schedule()


@router.get("/{course_id}")
def get_course(course_id: int):
    course = services.get_course(course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    return course


@router.get("/{course_id}/hub")
def course_hub(course_id: int):
    hub = services.course_hub(course_id)
    if not hub:
        raise HTTPException(404, "Course not found")
    return hub


@router.get("/{course_id}/content-tree")
def content_tree(course_id: int):
    if not services.get_course(course_id):
        raise HTTPException(404, "Course not found")
    nodes = services.list_content_nodes(course_id)
    files = services.list_files(course_id)
    return {"nodes": nodes, "files": files, "file_topics": services.list_file_topics(course_id)}


@router.get("/{course_id}/workspace/tree")
def workspace_tree(course_id: int):
    tree = services.workspace_tree(course_id)
    if tree is None:
        raise HTTPException(404, "Course not found")
    return tree


@router.get("/{course_id}/workspace/file")
def workspace_file_read(course_id: int, path: str = Query(...)):
    try:
        return services.workspace_read(course_id, path)
    except FileNotFoundError:
        raise HTTPException(404, "File not found")
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e))


@router.put("/{course_id}/workspace/file")
def workspace_file_write(course_id: int, path: str = Query(...), payload: dict | None = None):
    content = (payload or {}).get("content", "")
    if content is None:
        raise HTTPException(400, "content required")
    try:
        result = services.workspace_write(course_id, path, content)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except (ValueError, PermissionError) as e:
        raise HTTPException(400 if not isinstance(e, PermissionError) else 403, str(e))
    services.workspace_audit("write", course_id, path, {"size": result["size"],
                                                        "before": result["before"],
                                                        "after": result["after"]})
    return result


@router.delete("/{course_id}/workspace/file")
def workspace_file_delete(course_id: int, path: str = Query(...)):
    try:
        result = services.workspace_delete(course_id, path)
    except FileNotFoundError:
        raise HTTPException(404, "File not found")
    except PermissionError as e:
        raise HTTPException(403, str(e))
    services.workspace_audit("delete", course_id, path, {"size": result["size"]})
    return result


@router.post("/{course_id}/workspace/dir")
def workspace_dir_create(course_id: int, path: str = Query(...)):
    try:
        result = services.workspace_mkdir(course_id, path)
    except (ValueError, PermissionError) as e:
        raise HTTPException(400 if not isinstance(e, PermissionError) else 403, str(e))
    services.workspace_audit("mkdir", course_id, path, {})
    return result


@router.post("/{course_id}/workspace/upload")
async def workspace_file_upload(course_id: int, path: str = Query(...),
                                file: UploadFile = File(...)):
    """Store raw uploaded bytes in a writable workspace dir (notes/, work/,
    uploads/). Guard rails only — no size cap beyond a runaway valve and a disk
    floor. No extraction: the agent reads the file on demand."""
    def reader(n: int) -> bytes:
        # `.file` is the sync spooled temp file; a bounded chunk keeps memory
        # flat regardless of upload size.
        return file.file.read(min(n, 1024 * 1024))

    try:
        result = await asyncio.to_thread(
            services.workspace_upload, course_id, path, reader)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(413 if "too large" in str(e) else 400, str(e))
    except OSError as e:
        if e.errno == errno.ENOSPC:
            raise HTTPException(507, "not enough disk space")
        raise HTTPException(500, str(e))
    finally:
        await file.close()
    services.workspace_audit("upload", course_id, path,
                             {"size": result["size"], "sha256": result["sha256"]})
    return result


@router.get("/{course_id}/assignments")
def assignments(course_id: int, upcoming: bool = False):
    if not services.get_course(course_id):
        raise HTTPException(404, "Course not found")
    return services.list_assignments(course_id, upcoming_only=upcoming)


@router.get("/{course_id}/assignments/{assignment_id}")
def assignment_detail(course_id: int, assignment_id: int):
    if not services.get_course(course_id):
        raise HTTPException(404, "Course not found")
    a = services.get_assignment(course_id, assignment_id)
    if not a:
        raise HTTPException(404, "Assignment not found")
    return a


@router.get("/{course_id}/files")
def files(course_id: int):
    if not services.get_course(course_id):
        raise HTTPException(404, "Course not found")
    return services.list_files(course_id)


@router.get("/{course_id}/memory")
def memory_card(course_id: int):
    if not services.get_course(course_id):
        raise HTTPException(404, "Course not found")
    return {"markdown": services.get_memory_card(course_id)}


@router.get("/{course_id}/resolve-ref")
def resolve_ref(course_id: int, ref: str = Query(...)):
    if not services.get_course(course_id):
        raise HTTPException(404, "Course not found")
    target = services.resolve_ref(course_id, ref)
    if not target:
        raise HTTPException(404, "ref not found")
    return target
