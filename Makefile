# Campus — common tasks
#
# Build the web UI after any change to web/src (the deployment serves
# web/dist directly, so it must be rebuilt separately from the Python app):
#   make build-web
#
# Full image rebuild (bakes web/dist into the image — used when the
# deployment does NOT mount the repo at /app):
#   make build
#   make up

WEB_DIR := web
ROOT := $(dir $(lastword $(MAKEFILE_LIST)))

.PHONY: build-web build up dev

# Local run without Docker: venv, built web UI, sample data, then uvicorn on
# :8000. Mirrors the "Without Docker" steps in README.md. The seed and the
# sample timetable only run when data/harness.db is missing, so this never
# overwrites a real synced database with sample data.
dev:
	python3 -m venv .venv
	.venv/bin/pip install -q -r requirements.txt -r api/requirements.txt
	test -f config.yaml || cp config.example.yaml config.yaml
	if [ ! -f data/harness.db ]; then \
		echo '>> seeding sample data'; \
		.venv/bin/python seed/seed.py && \
		.venv/bin/python tools/ics_import.py seed/sample.ics; \
	fi
	cd web && (test -d node_modules || npm ci)
	cd web && npm run build
	.venv/bin/python -m uvicorn api.main:app --port 8000

build-web:
	@bash $(ROOT)scripts/build-web.sh

build:
	docker compose build

up:
	docker compose up -d
