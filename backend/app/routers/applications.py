"""Applications router — filled in Phase 4 (application CRUD).

Intentionally empty APIRouter so main.py can mount it now and Phase 4 can
add endpoints without touching shared files.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/applications", tags=["applications"])

# Phase 4 endpoints go here.
