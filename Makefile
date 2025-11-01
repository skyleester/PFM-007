SHELL := /bin/zsh

.PHONY: dev dev-backend dev-web install-backend install-web ensure-backend-deps dev-check clean-bak

# Config
PY := $(PWD)/.venv/bin/python
BACKEND_HOST := 127.0.0.1
BACKEND_PORT := 8000
BACKEND_APP := app.main:app
MIGRATE := cd apps/backend && "$(PY)" -m alembic

dev: ## Run backend (8000) and web (3000) together
	$(MAKE) ensure-backend-deps
	@echo "[dev] Applying database migrations"
	@$(MIGRATE) upgrade heads
	( trap 'kill 0' INT TERM EXIT; \
	  echo "[dev] Starting backend on http://$(BACKEND_HOST):$(BACKEND_PORT)"; \
	  "$(PY)" -m uvicorn --app-dir apps/backend $(BACKEND_APP) --host $(BACKEND_HOST) --port $(BACKEND_PORT) --reload & \
	  until curl -fsS http://$(BACKEND_HOST):$(BACKEND_PORT)/health >/dev/null 2>&1; do echo "[dev] Waiting for backend..."; sleep 0.3; done; \
	  echo "[dev] Backend is up. Starting web on http://127.0.0.1:3000"; \
	  cd apps/web && NEXT_PUBLIC_BACKEND_URL=http://$(BACKEND_HOST):$(BACKEND_PORT) npm run dev & \
	  wait )

dev-backend: ## Run only backend API
	@echo "[dev-backend] Applying database migrations"
	@$(MIGRATE) upgrade heads
	"$(PY)" -m uvicorn --app-dir apps/backend $(BACKEND_APP) --host $(BACKEND_HOST) --port $(BACKEND_PORT) --reload

dev-web: ## Run only web app
	cd apps/web && NEXT_PUBLIC_BACKEND_URL=http://$(BACKEND_HOST):$(BACKEND_PORT) npm run dev

install-backend: ## Install backend deps into repo venv (expects .venv already)
	"$(PY)" -m pip install -e apps/backend

install-web: ## Install web deps
	cd apps/web && npm install

ensure-backend-deps: ## Ensure backend runtime deps are installed in venv
	@if [ ! -x "$(PY)" ]; then echo "[ensure] Python venv not found at $(PY). Create it and install deps."; exit 1; fi
	@"$(PY)" -c "import uvicorn, fastapi" >/dev/null 2>&1 || { \
	  echo "[ensure] Installing backend deps into venv..."; \
	  $(MAKE) install-backend; \
	}

dev-check: ## Quick health check for backend
	@echo "GET http://$(BACKEND_HOST):$(BACKEND_PORT)/health" && curl -sS http://$(BACKEND_HOST):$(BACKEND_PORT)/health || true

clean-bak: ## Remove backup routes (any *_bak dirs under apps/web/app)
	@echo "[clean-bak] Removing backup routes under apps/web/app"
	@find apps/web/app -type d -name '*_bak' -prune -exec echo rm -rf {} +
	@find apps/web/app -type d -name '*_bak' -prune -exec rm -rf {} +
