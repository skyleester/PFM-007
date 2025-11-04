# Phase 2 – Transaction Router Migration

- Added `apps/backend/routers/transactions.py` exposing all `/transactions*` endpoints through the new modular router while delegating to the legacy handlers.
- Updated `apps/backend/routers/__init__.py` to mount the new router and filter out transaction paths from the legacy `routers.py` inclusion.
- Left the original transaction route implementations in `apps/backend/app/routers.py` with a TODO marker so we can compare behaviour until the legacy router is retired.

Smoke test reminder: run `uvicorn apps.backend.app.main:app --reload` (or the project’s FastAPI task) and hit `/api/transactions` endpoints to confirm responses match the previous behaviour.
