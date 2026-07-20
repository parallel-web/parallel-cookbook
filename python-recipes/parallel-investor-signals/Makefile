# Developer ergonomics. Every target assumes repo root.
VENV := project/backend/.venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

.PHONY: help setup dev backend frontend test test-backend test-frontend lint build clean

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup: ## One-time: venv + backend deps + dev tools + frontend deps
	python3 -m venv $(VENV)
	$(PIP) install -q -r project/backend/requirements.txt -r requirements-dev.txt
	cd project && npm install
	@test -f .env || cp .env.example .env
	@echo "→ fill in .env (PARALLEL_API_KEY at minimum), then: make dev"

backend: ## Run the FastAPI backend on :8000
	cd project && $(abspath $(PY)) -m uvicorn backend.main:app --reload --port 8000

frontend: ## Run the Vite dev server on :5173
	cd project && npm run dev

dev: ## Print the two commands to run (separate terminals)
	@echo "terminal 1:  make backend"
	@echo "terminal 2:  make frontend"

test: test-backend test-frontend ## All tests

test-backend: ## Backend unit + integration tests
	$(PY) -m pytest

test-frontend: ## Frontend lib tests
	cd project && npm run test -- --run

lint: ## Ruff over Python
	$(VENV)/bin/ruff check .

build: ## Production frontend build (also typechecks)
	cd project && npm run build

clean: ## Remove generated artifacts
	rm -rf project/dist project/node_modules $(VENV)
