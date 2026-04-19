"""Support router — filled in Phase 6 (ticket intake + SES mail).

Intentionally empty APIRouter so main.py can mount it now and Phase 6 can
add endpoints without touching shared files.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/support", tags=["support"])

# Phase 6 endpoints go here.
