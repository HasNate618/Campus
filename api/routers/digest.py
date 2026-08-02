from __future__ import annotations

from fastapi import APIRouter

from api import services

router = APIRouter(prefix="/api/digest", tags=["digest"])


@router.get("/latest")
def latest_digest():
    return services.get_digest()
