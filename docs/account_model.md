# Account model (design)

This document describes the Account models used to represent any entity that can hold or move money in the Personal Finance Manager.

Sources of truth:
- Reference spec: `models/account.py`
- Backend integration (non-breaking): `apps/backend/app/models.py::AccountV2`

## Purpose

The Account model unifies many real-world containers of money into a single type with a minimal, extensible schema. It powers transfers, balances, and reporting across:

- Bank accounts (예금, 적금, 마이너스통장)
- Cards (신용/체크)
- Points/Wallets (네이버페이, 카카오페이, 삼성페이)
- Brokerage/Stock and Pension accounts
- Loans and virtual wallets (현금/기타)

## Fields (AccountV2)

- `id` (PK)
  - Integer identifier.
- `name` (string, required)
  - Display name shown in the UI. Example: "농협 입출금 1234" / "삼성카드".
- `type` (enum)
  - See AccountKind below. Determines behavior in balances and analytics.
- `provider` (string)
  - Institution or brand. Example: "NH", "KB", "Samsung Card".
- `balance` (decimal, nullable)
  - Current balance. Nullable for accounts that don't track a running balance (e.g., some points wallets).
- `currency` (string, default "KRW")
  - ISO 4217 code.
- `parent_id` (FK -> account.id, nullable)
  - Enables hierarchical accounts. Example: 카드 → 포인트, 은행 → 적금.
- `is_active` (boolean)
  - Visibility and participation in calculations.
- `metadata` (JSON)
  - Free-form extensibility. Examples: account color, external IDs, billing days, UI flags.
  - Implementation detail: to avoid clashing with SQLAlchemy's `Base.metadata`, the code exposes this as `extra_metadata` attribute while persisting to DB column named `metadata`.
- `created_at`, `updated_at` (timestamps)
  - Auditing and sync.

## Enum: AccountKind

- `BANK` — Deposit/Savings/Checking-like bank accounts (예금/적금/마통)
- `CARD` — Credit/Debit card accounts
- `POINT` — Points/Wallets (네이버/카카오/삼성 페이 등)
- `STOCK` — Brokerage/Securities
- `PENSION` — Retirement/Pension
- `LOAN` — Loan/Credit line
- `CASH` — Cash on hand
- `VIRTUAL` — Virtual/synthetic buckets

## Hierarchy examples

- 카드 → 포인트
  - Parent: "삼성카드" (type=CARD)
  - Child: "삼성카드 포인트" (type=POINT)
- 은행 → 적금
  - Parent: "농협 입출금통장" (type=BANK)
  - Child: "NH 적금 24개월" (type=BANK)
- 증권 → CMA/주식 계정
  - Parent: "KB증권" (type=STOCK)
  - Child: "KB CMA" (type=STOCK)

## Design considerations

- Parent-child structure
  - Real-world products come in bundles (e.g., 카드 본체와 포인트 지갑). A hierarchical model keeps them discoverable and linked.
- Minimal core schema
  - The schema focuses on universal fields; product-specific details live in `metadata`.
- JSON metadata
  - Allows gradual enhancement without migrations: billing days, external account IDs, UI badges, etc.
- Enum-driven logic
  - High-level type gates specialized business rules (e.g., settlement flows for CARD, reporting exclusions for LOAN).

## Keeping code and docs in sync

- The reference implementation lives in `models/account.py` and the backend-integrated model is `AccountV2`.
- When updating fields or the `AccountKind` enum, reflect the same intent here (and vice versa).
- In the FastAPI app we keep a separate table `account_v2` to avoid affecting the legacy `account` table.

## Differences vs legacy Account (summary)

- Separate table: `account_v2` (legacy remains `account`), introduced via Alembic migration without modifying existing data.
- Unified enum `AccountKind` instead of legacy `AccountType` categories.
- Hierarchical structure by `parent_id` (self FK) for 카드→포인트, 은행→적금 등.
- JSON metadata stored in DB column `metadata` and exposed as `extra_metadata` in the ORM to avoid `Base.metadata` naming clash.
- Simplified core schema (name/type/provider/balance/currency/is_active) with extensibility via metadata.

## AccountV2 API Endpoints

Base path: `/api/v2/accounts`

- GET `/` — List accounts
  - Query params:
    - `is_active` (optional bool): filter by active flag
    - `eager` (optional bool, default=false): eager-load `parent`/`children`
  - Response: `AccountV2Out[]`

- GET `/{id}` — Get one
  - Query params: `eager` (optional bool)
  - Response: `AccountV2Out`

- POST `/` — Create
  - Body: `AccountV2Create`
  - Response: `AccountV2Out`

- PUT `/{id}` — Replace
  - Body: `AccountV2Create` (full shape)
  - Response: `AccountV2Out`

- PATCH `/{id}` — Partial update
  - Body: `AccountV2Update`
  - Response: `AccountV2Out`

- DELETE `/{id}` — Delete
  - Response: 204 No Content

- GET `/tree` — Return hierarchy
  - Query params: `is_active` (optional bool)
  - Response: `AccountV2TreeNode[]` (each node contains `children`)

### Schemas (summary)

- AccountV2Create / AccountV2Base
  - name: string
  - type: AccountKind
  - provider?: string
  - balance?: decimal
  - currency: string = "KRW"
  - parent_id?: number
  - is_active: boolean = true
  - extra_metadata: object = {}

- AccountV2Update
  - All fields optional (partial)

- AccountV2Out
  - All base fields + `id`, `created_at`, `updated_at`

### Example payloads

Create

```json
{
  "name": "NH 입출금 1234",
  "type": "BANK",
  "provider": "NH",
  "balance": "1000000.00",
  "currency": "KRW",
  "is_active": true,
  "extra_metadata": {"color": "#1f8f55"}
}
```

Read

```json
{
  "id": 12,
  "name": "NH 입출금 1234",
  "type": "BANK",
  "provider": "NH",
  "balance": "1000000.00",
  "currency": "KRW",
  "parent_id": null,
  "is_active": true,
  "extra_metadata": {"color": "#1f8f55"},
  "created_at": "2025-11-04T12:00:00",
  "updated_at": "2025-11-04T12:00:00"
}
```

Tree response (simplified)

```json
[
  {
    "id": 21,
    "name": "삼성카드",
    "type": "CARD",
    "currency": "KRW",
    "is_active": true,
    "extra_metadata": {},
    "created_at": "2025-11-04T12:00:00",
    "updated_at": "2025-11-04T12:00:00",
    "children": [
      {
        "id": 22,
        "name": "삼성카드 포인트",
        "type": "POINT",
        "currency": "KRW",
        "is_active": true,
        "extra_metadata": {},
        "created_at": "2025-11-04T12:00:00",
        "updated_at": "2025-11-04T12:00:00",
        "children": []
      }
    ]
  }
]
```
