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

.PHONY: build-web build up eval

# Retrieval metrics, plus answer metrics when an LLM endpoint is configured.
# Results land in eval/results/, which is gitignored. See eval/README.md.
EVAL_QUESTIONS ?= eval/questions.example.yaml

eval:
	.venv/bin/python eval/run.py --questions $(EVAL_QUESTIONS)

build-web:
	@bash $(ROOT)scripts/build-web.sh

build:
	docker compose build

up:
	docker compose up -d
