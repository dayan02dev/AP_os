#!/usr/bin/env bash
#
# run.sh — prod → staging Supabase data import wrapper
#
# Sources .env.import (gitignored) and invokes import.py. All script
# args are forwarded — e.g. `./run.sh --dry-run` is supported.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/.env.import" ]; then
    echo "ERROR: $SCRIPT_DIR/.env.import not found." >&2
    echo "Copy .env.import.example to .env.import and fill in the keys." >&2
    exit 1
fi

# Export every variable defined in .env.import.
set -a
# shellcheck disable=SC1091
source "$SCRIPT_DIR/.env.import"
set +a

# Pick the Python interpreter. Prefer the project's backend venv if it
# exists; otherwise fall back to the user's `python3`.
if [ -x "$SCRIPT_DIR/../../.venv/bin/python" ]; then
    PY="$SCRIPT_DIR/../../.venv/bin/python"
elif [ -x "$SCRIPT_DIR/../../venv/bin/python" ]; then
    PY="$SCRIPT_DIR/../../venv/bin/python"
else
    PY="python3"
fi

cd "$SCRIPT_DIR"
exec "$PY" import.py "$@"
