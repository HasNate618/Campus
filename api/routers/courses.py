from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from api import services

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.get("")
def list_courses(active_only: bool = True):
    return services.list_courses(active_only=active_only)


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
    return {"nodes": nodes, "files": files}


@router.get("/{course_id}/assignments")
def assignments(course_id: int, upcoming: bool = False):
    if not services.get_course(course_id):
        raise HTTPException(404, "Course not found")
    return services.list_assignments(course_id, upcoming_only=upcoming)


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
