# Phase 3 – Account Router Migration

- Added `apps/backend/routers/accounts.py` exposing `/accounts*` and credit-card summary/statement endpoints through the modular router while delegating to the legacy implementations.
- Updated `apps/backend/routers/__init__.py` to mount the accounts router before the transactions router and to filter account paths out of the legacy inclusion list.
- Left the original account route functions in `apps/backend/app/routers.py` for behavioural parity until we finish relocating their business logic.

Smoke test reminder: run `uvicorn apps.backend.app.main:app --reload` (or the FastAPI VS Code task) and exercise `/api/accounts` plus the nested credit-card endpoints to confirm responses match the pre-migration behaviour.
