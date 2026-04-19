"""Resume router — filled in Phase 5 (upload + OpenRouter parsing).

Intentionally empty APIRouter so main.py can mount it now and Phase 5 can
add endpoints without touching shared files.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/resume", tags=["resume"])

# Phase 5 endpoints go here.
