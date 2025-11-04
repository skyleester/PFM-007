# Phase 1 – Router Modularization Scaffold

- Added `apps/backend/routers/__init__.py` with `register_routers(app)` to mount the legacy `routers.py` module behind the new package entry point.
- Updated `apps/backend/app/main.py` to call `register_routers(app)` instead of importing the monolithic router directly.
- Left `apps/backend/app/routers.py` untouched so all existing endpoints continue to function while we prepare for phased extraction.

Next step: migrate transaction-related endpoints into `routers/transactions.py` and update the aggregator accordingly.
