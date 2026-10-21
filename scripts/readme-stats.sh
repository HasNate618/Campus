#!/usr/bin/env bash
# Print the counts the README quotes, so updating them is mechanical instead
# of remembered. Run this before touching any number in README.md.
#
# Usage: bash scripts/readme-stats.sh
#
# Every line is derived from the code, never hard-coded:
#   backend tests  pytest --collect-only
#   tools          entries of TOOLS in agent/tools.py
#   tables         CREATE TABLE statements in schema.sql
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="${PYTHON:-.venv/bin/python}"
if [ ! -x "$PY" ]; then
	echo "no $PY; create it with: python3 -m venv .venv" >&2
	exit 1
fi

# pytest.ini already sets -q; a second -q silences the "N tests collected"
# line this script is here to read.
tests="$("$PY" -m pytest --collect-only 2>/dev/null | tail -1)"
files="$(find tests -maxdepth 1 -name 'test_*.py' | wc -l | tr -d ' ')"
tools="$(sed -n '/^TOOLS = {/,/^BUILTIN_TOOL_NAMES/p' agent/tools.py \
	| grep -cE '^    "[a-z_]+": _tool' || true)"
tables="$(grep -c 'CREATE TABLE' schema.sql || true)"

printf 'backend tests:  %s\n' "$tests"
printf 'test files:     %s\n' "$files"
printf 'built-in tools: %s\n' "$tools"
printf 'tables:         %s\n' "$tables"
