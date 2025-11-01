```instructions
# Personal Finance Manager – Copilot Guide

## Monorepo layout
- `apps/backend`: FastAPI + SQLAlchemy + Alembic. Entry points under `app/`.
- `apps/web`: Next.js 15 (App Router) with TypeScript and Tailwind.
- Shared development tooling lives at the workspace root (Makefile, `.venv`, etc.).

## Domain rules
- Core entities: users, user_profiles, accounts, category_groups, categories, transactions, budgets. Optional but planned: payees, tags, attachments, recurring_rules, currencies, exchange_rates, transfer_groups.
- Category codes follow `Type (I/E/T) + GG(00-99) + CC(00-99)`; `00` means "미분류".
- Manual transfers still create paired OUT/IN rows via `transfer_group`, but bulk auto-matched transfers collapse into a single row with `is_auto_transfer_match=True`; that row carries both account and counter-account so balances move once per direction.

### Credit card accounts
- Introduce an `AccountType.CREDIT_CARD` that requires `linked_account_id` (DEPOSIT only), `payment_day` (1-31), and `billing_cutoff_day` (1-31). Validate month-end overflow by snapping to the last day.
- Track billing cycles in a `credit_card_statement` table containing `period_start`, `period_end`, `due_date`, `total_amount`, `status (pending|paid|closed)`, and `settlement_transaction_id` to prevent duplicate settlements.
- Card usage transactions live on the credit card account with `status=PENDING_PAYMENT`, `is_balance_neutral=True`, and a `statement_id` pointer; they should not touch linked-account balances.
- Settlement runs on or after `due_date`: sum pending statement items, create a single expense on the linked deposit account (`type=EXPENSE`, `is_balance_neutral=False`), optionally record a matching settlement entry on the card for audit, then mark the statement paid.
- Enforce idempotency by checking statement status before settlement; new usage auto-attaches to the active statement (create or reuse based on cutoff/day logic).
- UI: when account type is credit card, surface payment day, cutoff day, linked account selector, current outstanding amount (active statement total), and next scheduled settlement info. Distinguish usage (`pending_payment`) vs settlement (`cleared`) status in calendar/transactions views.

## Coding standards
- Prefer dependency-free helpers unless a library is already in use (SQLAlchemy, Pydantic, FastAPI, Next.js ecosystem, XLSX parsing).
- Keep business logic in FastAPI routers/services, not in request handlers, when it grows beyond a few lines.
- For React/Next, favor functional components and hooks. Keep state colocated and ensure server actions remain in `/app`.
- TypeScript: strict mode is effectively on; add explicit types for new public APIs.
- Python: follow black-ish formatting (4 spaces), type hint new functions, and update Alembic migrations when models change.

## Testing & verification
- Backend: run `pytest` from `apps/backend`. Use the existing SQLite fixtures; avoid adding external services.
- Frontend: run `npm run lint` and add React Testing Library coverage when touching complex UI logic.
- For database schema changes, add or chain Alembic migrations; never edit historical migrations.

## Transfer pairing expectations
- Importers must supply `transfer_flow` hints plus account/counter account names.
- Bulk upload pairing should match transfers using account identifiers before falling back to heuristics; unmatched items remain as standalone transactions.
- When updating this logic, verify with Banksalad samples containing multiple same-amount transfers.
- During bulk upload, if two transfers share the same occurred_at, occurred_time, currency, and absolute amount, only one transaction should be created. Use `transfer_flow` to decide the sign (account minus for OUT, plus for IN) and drop the mirrored row. Transfers without such a pair represent external movement and must affect balances (no neutralizing).

## Workflow notes
- Use the provided VS Code tasks (`Run Backend`, etc.) when suggesting commands.
- Document user-facing changes in the main `README.md` when behavior changes.
- Prefer incremental patches and keep edits scoped; avoid unrelated refactors.
- Flag TODOs in comments only when work is intentionally deferred and include brief rationale.
- When migrations change, run `PYTHONPATH="apps/backend" .venv/bin/alembic upgrade heads` so SQLite/PostgreSQL schemas stay aligned across multi-head branches.

## Upcoming feature requests
- Transfer transactions need an opt-out toggle in the detail panel to exclude them from balance calculations and calendar summaries while keeping them in the ledger.
- Calendar date panels should offer a "자세히보기" link that opens the transactions page filtered to that date, plus allow clicking a summary transaction to jump into the transactions page with its edit modal pre-opened after confirmation.
- Account view requires a running balance column derived from the user-provided current balance, keeping current and initial balances in sync (updating one recalculates the other).

## In-flight work (2025-10)
- Credit-card settlement rework: split real card usage vs settlement flows, add `TxnType.SETTLEMENT`, `is_card_charge`, `card_id`, `billing_cycle_id`, `imported_source_id`, and update migrations/services/import/statistics/UI accordingly. Settlement transactions must be excluded from expense analytics while remaining linked to their billing cycles.

## Statistics page roadmap
- Goal: Statistics dashboard with KPI cards, trend charts, and consumption insights fed by transaction/account/category data.
- Phase 1 (current work): Convert `/statistics` to a data-driven page with server component wrapper, shared types under `lib/statistics/types.ts`, and a `useStatisticsData` hook to fetch aggregated metrics (month-by-month totals, category mix, account balances). Prepare reusable client components for KPIs and charts.
- Data sources: existing `/api/transactions`, `/api/accounts`, `/api/category-groups`/`/api/categories`; plan to introduce `/api/analytics/overview` and `/api/analytics/accounts/timeline` to reduce client aggregation cost.
- Visualization stack: add `recharts` (preferred) for line/bar/donut charts; ensure Vitest/jsdom compatibility. Arrange layout as KPI row → trend charts grid → insights cards with filters for date range, account, category.
- Insights backlog: weekday/time heatmap, top-rising categories (recent 30d vs prior), budget comparison, balance alerts.

## Calendar implementation priorities
1. Establish the data layer for date-based views: fetch transactions within a range, recurring rule previews (e.g., 60–90 day horizon), and surface upcoming events/anniversaries from a lightweight store.
2. Build the shared calendar shell: view switcher (month/week/day), navigation controls (previous/next/today), and `useCalendarData` hook that aggregates transaction + recurring data keyed by date.
3. Deliver the month view first: render a 7×5 grid with per-day aggregates, recurring indicators, and a side/drawer detail panel when a date is selected.
4. Extend to week and day views: reuse the data hook, add timeline-style rendering for daily detail, and provide weekly summaries.
5. Layer on enhancements after core views: filters (account/category), memo/anniversary CRUD, and marking recurring instances as completed when matching actual transactions.

## Recurring page priorities
1. Set up API layer (`lib/recurring/api.ts`) and typings for list/create/update/delete/preview endpoints.
2. Implement data hooks (`useRecurringData`, `useRecurringPreview`) with refresh handling and error states.
3. Render page scaffold with summary header showing rule counts and upcoming totals.
4. Build filterable rules table with selection-driven detail panel.
5. Implement detail panel with preview tab and action buttons (toggle active, edit, delete).
6. Add create/edit form (slide-over or modal) wiring POST/PATCH flows with optimistic refresh.
7. Integrate status toggles and deletion with optimistic UI + error rollback.
8. Add frontend tests and accessibility polish (focus management, ARIA labels).
9. (추가 예정) 공휴일 캘린더를 활용해 정기 수입/지출이 휴일과 겹칠 때 앞/뒤 조정 전략을 사용자가 선택할 수 있도록 UI/로직을 확장한다. 공공데이터포털 API 안정화 이후 재검토.

## Copilot generation behavior
- Generate complete, runnable code — avoid `# TODO` placeholders unless explicitly stated.
- Always include imports.
- Prefer composition over inheritance in service classes.
- When unsure about types, propose explicit type hints instead of `Any`.
- Keep generated files self-contained unless clearly modular.

## Helpful commands
- Backend dev server: `uvicorn app.main:app --reload` (run from `apps/backend`).
- Apply migrations: `PYTHONPATH="apps/backend" .venv/bin/alembic upgrade heads` from repo root.
- Frontend dev server: `npm run dev` inside `apps/web`.

## Feature reference (2025-10)

### Backups (DB snapshot)
- Provide a full SQLite backup (WAL-aware) with metadata JSON capturing optional memo and credit-card pending snapshot.
- Restore safely detects WAL and maintains balances; manual balances are preserved.
- UI under Preferences allows create/list/restore/delete with size/date/memo display.

### Recurring — scan exclusions
- Persist excluded candidates with a deterministic `signature_hash` derived from the grouping key.
- Scan skips any group whose signature is excluded for the user.
- Expose CRUD: `GET/POST/DELETE /recurring/exclusions` and include `signature_hash` in `scan-candidates` response.
- Frontend: show two tabs (candidates/excluded), with per-row “규칙 아님” and “복원”, plus a bulk “모두 배제”.

### Credit-card settlement details
- Keep usage vs settlement separated; usage is balance-neutral on card, settlement is a single expense on linked deposit.
- Enforce idempotency and bind usage to active statement based on cutoff/day logic.

## Session Notes (2025-10-21)

### Recurring matching — backend
- Added nearest-occurrence snapping for attach/retarget within ±7 days. If no occurrence is within tolerance, return 400.
- Restored `_iter_occurrences(rule, start, end)` generator (DAILY/WEEKLY/MONTHLY/YEARLY) and moved `_resolve_occurrence_date(...)` to module scope to fix a 500 regression.
- Implemented detach endpoint to clear a transaction’s recurring link.
- Implemented skip/unskip/list for occurrences; pending calculations exclude skipped dates; 409 treated as idempotent.
- external_id convention: `rule-{rule_id}-{YYYY-MM-DD}`; uniqueness enforced.

Endpoints
- POST `/api/recurring-rules/{rule_id}/attach-to-occurrence`
- POST `/api/recurring-rules/{rule_id}/retarget`
- POST `/api/recurring-rules/{rule_id}/detach`
- POST `/api/recurring-rules/{rule_id}/skip`
- DELETE `/api/recurring-rules/{rule_id}/skip/{date}`
- GET `/api/recurring-rules/{rule_id}/skips`

### Recurring matching — frontend
- Per-occurrence UI supports date picker, ±N-day (0/3/7/14) candidate window, and include-linked toggle (for retarget).
- Row actions: “이 거래로 매칭”(unlinked), “링크 재지정/매칭 해제”(linked).
- Skip panel with memo and restore; local pending list immediately filters out skipped dates; parent refresh after actions to sync state.

### Workflow & tooling
- Added `scripts/dev-win.ps1` for Windows-friendly backend/dev tasks (venv, Alembic, uvicorn).
- Minor `.vscode/tasks.json` tweak to streamline backend run.
- Alembic migrations added: recurring occurrence skip table and heads merge.
- Backups: created a SQLite snapshot and updated `backups/metadata.json`.

### Quality gates
- Backend runs via uvicorn; `/api/recurring-rules` returns 200 after fix.
- No static errors reported in edited backend file; tests recommended next.

### Next steps
- Add unit tests for `_resolve_occurrence_date` and `_iter_occurrences` (month-end, leap-year, weekly offsets).
- Document user-facing changes in README (attach/retarget/detach/skip, nearest-occurrence snapping).
- Consider a “best match” auto-suggestion (closest date/amount) in the matching UI.
```