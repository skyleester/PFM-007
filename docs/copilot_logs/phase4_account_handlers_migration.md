# Phase 4 – Account Handlers Migration

- Added `apps/backend/app/api/accounts/handlers.py` and moved account CRUD plus credit-card statement/summary handlers out of the monolithic `routers.py`. Reused existing helper utilities via direct imports to preserve behaviour without rewriting validation logic.
- Retargeted `apps/backend/routers/accounts.py` so it mounts the new handlers directly rather than delegating through the legacy router module.
- Pruned the legacy account endpoints and helper from `apps/backend/app/routers.py`, keeping only shared utilities that other features still depend on.

Smoke test reminder: run `uvicorn apps.backend.app.main:app --reload` (or the FastAPI VS Code task) and exercise `/api/accounts` and the nested credit-card endpoints to confirm responses are unchanged.
