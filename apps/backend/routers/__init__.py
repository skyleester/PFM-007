"""Router aggregation helpers for the modularization effort.

Phase 1 introduced this package to wrap the monolithic router. Starting in
Phase 2, we mount feature-specific routers here while gradually pruning the
legacy `routers.py` module.
"""

from fastapi import FastAPI

from app import routers as legacy_router_module

from . import accounts, transactions
from app.api.v2.account_v2_router import router as account_v2_router

_EXCLUDED_LEGACY_PREFIXES = ("/accounts", "/transactions")


def register_routers(app: FastAPI) -> None:
    """Attach all API routes to the FastAPI application."""

    app.include_router(accounts.router, prefix="/api")
    app.include_router(transactions.router, prefix="/api")
    # New v2 routers
    app.include_router(account_v2_router, prefix="/api/v2")

    legacy_router = legacy_router_module.router
    legacy_router.routes = [
        route
        for route in legacy_router.routes
        if not any(route.path.startswith(prefix) for prefix in _EXCLUDED_LEGACY_PREFIXES)
    ]
    app.include_router(legacy_router, prefix="/api")
