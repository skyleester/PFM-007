```instructions
# Personal Finance Manager – Copilot Guide (concise)

## Monorepo & data flow
- Backend `apps/backend`: FastAPI + SQLAlchemy + Alembic (entry under `app/`). Routers in `app/routers` and `routers/` (legacy), services in `app/services`, tests in `apps/backend/tests`.
- Frontend `apps/web`: Next.js 15 App Router + TypeScript + Tailwind. Pages under `app/`, shared UI in `components/`, data hooks in `hooks/`.
- Data flow: Next.js calls FastAPI `/api/*` (see examples in `apps/backend/tests/`); analytics endpoints planned to reduce client aggregation.

## Domain essentials (implement like this repo does)
- Category code: `Type(I/E/T)+GG(00-99)+CC(00-99)`; `00` = 미분류. See `docs/schema.md` and usage across tests.
- Transfers: bulk uploads collapse mirrored pairs when same `occurred_at/occurred_time/currency/abs(amount)`; use `transfer_flow` to decide sign; external movements affect balances. See `.github/transfer-matching-*.md`, `apps/backend/tests/test_transfer_pairing_service.py`.
- Credit cards: `AccountType.CREDIT_CARD` requires `linked_account_id`(DEPOSIT), `payment_day`, `billing_cutoff_day`. Usage rows live on the card as balance-neutral; statements track period & due; settlement creates one expense on the linked deposit and marks statement paid. Idempotent by status/`settlement_transaction_id`.

## Backend patterns
- Keep business logic in routers/services; schemas in `app/schemas.py`; models in `app/models.py` with Alembic migrations under `alembic/versions`.
- SQLite migrations must run with batch mode: ensure `apps/backend/alembic/env.py` sets `render_as_batch=True` for SQLite (fixes ALTER TABLE limits).
- Tests use SQLite fixtures; run focused tests like `tests/test_analytics.py`, `tests/test_recurring.py` to guide changes.

## Frontend patterns
- App Router with server components by default; convert to client where interactivity needed. Keep API wrappers in `apps/web/lib/*.ts` and hooks under `apps/web/hooks/*`.
- For charts/metrics, use `recharts` and shared types (planned `lib/statistics/types.ts`). Pages: `app/statistics`, `app/transactions`, `app/recurring` mirror backend endpoints.

## Critical workflows (dev/test)
- Apply migrations and run backend: `PYTHONPATH="apps/backend" .venv/bin/alembic upgrade heads` → `uvicorn app.main:app --reload` (cwd `apps/backend`).
- Frontend: `npm run dev` in `apps/web` with `NEXT_PUBLIC_BACKEND_URL` set (defaults to `http://127.0.0.1:8000`).
- Tests: backend `PYTHONPATH=. .venv/bin/python -m pytest -q` from `apps/backend`; frontend `npm run lint` and (optional) `npm run test`.
- VS Code tasks and Make targets: `make dev`, `make dev-backend`, `make dev-web` orchestrate common flows.

## Gotchas & conventions
- Idempotency everywhere: bulk upload, recurring generation, credit-card settlement. Prefer explicit external_id patterns (e.g., `rule-{rule_id}-{YYYY-MM-DD}`).
- Transfer pairing: match by account identifiers first, then heuristics; keep unmatched as standalone. Verify with Banksalad samples; see `test_db_transfer_matching.py`.
- Backups: SQLite WAL-aware snapshot with metadata under `backups/`; Preferences UI handles create/list/restore.

## In-flight and roadmap (2025-10 →)
- Credit-card settlement rework: add `TxnType.SETTLEMENT`, `is_card_charge`, `card_id`, `billing_cycle_id`, `imported_source_id`; exclude settlement from expense analytics while keeping links.
- Statistics page Phase 1: wrap `/statistics` with server component, add `useStatisticsData`, and prefer backend aggregations (`/api/analytics/overview`, `/api/analytics/accounts/timeline`).
- Calendar/Recurring: build date-based data layer and skip/attach/retarget flows (see `tests/test_recurring.py` and README “What’s new”).

Feedback wanted: If any of the above feels unclear (e.g., settlement idempotency, transfer collapse rules, or analytics endpoints), tell me what you’re implementing next and I’ll expand that section with file-level pointers and examples.
```