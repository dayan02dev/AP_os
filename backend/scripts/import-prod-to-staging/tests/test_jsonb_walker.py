"""Unit tests for lib/jsonb_walker.py — pure JSONB storage-path extractor."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.jsonb_walker import (
    BucketPath,
    walk_application_storage,
    walk_resume_storage,
)


def test_walk_evidence_files_array():
    row = {
        "id": "app-1",
        "evidence_files": [
            {"storage_path": "uid-1/file-a.pdf", "name": "file-a.pdf"},
            {"storage_path": "uid-1/file-b.png", "name": "file-b.png"},
        ],
    }
    out = walk_application_storage(row)
    assert BucketPath("evidence-files", "tir-evidence-files", "uid-1/file-a.pdf") in out
    assert BucketPath("evidence-files", "tir-evidence-files", "uid-1/file-b.png") in out


def test_walk_evidence_deck_single():
    row = {
        "id": "app-2",
        "evidence_deck": {"storage_path": "uid-2/deck.pdf"},
    }
    out = walk_application_storage(row)
    assert BucketPath("evidence-files", "tir-evidence-files", "uid-2/deck.pdf") in out


def test_walk_execution_milestone_files():
    row = {
        "id": "app-3",
        "execution_milestone_files": [
            {"storage_path": "uid-3/budget.xlsx"},
        ],
    }
    out = walk_application_storage(row)
    assert BucketPath("milestone-files", "tir-milestone-files", "uid-3/budget.xlsx") in out


def test_walk_handles_null_values():
    row = {
        "id": "app-4",
        "evidence_files": None,
        "evidence_deck": None,
        "execution_milestone_files": None,
    }
    out = walk_application_storage(row)
    assert out == []


def test_walk_handles_missing_columns():
    row = {"id": "app-5"}
    out = walk_application_storage(row)
    assert out == []


def test_walk_skips_entries_without_storage_path():
    row = {
        "id": "app-6",
        "evidence_files": [
            {"name": "no-path.pdf"},                       # missing storage_path
            {"storage_path": "", "name": "empty.pdf"},     # empty string
            {"storage_path": "uid-6/real.pdf"},
        ],
    }
    out = walk_application_storage(row)
    assert len(out) == 1
    assert out[0].path == "uid-6/real.pdf"


def test_walk_resume_uploads():
    row = {"storage_path": "uid-1/resume.pdf"}
    out = walk_resume_storage(row)
    assert out == [BucketPath("resumes", "tir-resumes", "uid-1/resume.pdf")]


def test_walk_resume_handles_null():
    row = {"storage_path": None}
    out = walk_resume_storage(row)
    assert out == []
