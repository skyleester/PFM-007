# AccountV2 model and metadata

This document describes AccountV2 including kind-specific metadata shapes and helper endpoints.

Sources of truth:
- ORM model: `apps/backend/app/models.py::AccountV2`
- Metadata Pydantic schemas: `apps/backend/app/account_v2_metadata_schemas.py`
- API router: `apps/backend/app/api/v2/account_v2_router.py`

## AccountV2 recap

Core fields:
- id, name, type(AccountKind), provider?, balance?, currency(=KRW), parent_id?, is_active, extra_metadata(JSON), created_at, updated_at

Hierarchy examples:
- CARD → POINT (e.g., "삼성카드" → "삼성카드 포인트")
- BANK → BANK (입출금 → 적금)

## Metadata by AccountKind

Metadata lives in `extra_metadata` (DB column name `metadata`) and is validated via Pydantic models per kind.
Common optional fields across all kinds:
- color: string (UI color), external_ids: object (source→id mapping)

- BANK (BankMetadata)
  - institution_code?: string
  - account_number?: string

- CARD (CardMetadata)
  - billing_cutoff_day?: 1..31
  - payment_day?: 1..31
  - auto_deduct?: boolean
  - settlement_account_ref?: string

- POINT (PointMetadata)
  - provider_user_id?: string

- STOCK (StockMetadata)
  - brokerage_code?: string
  - account_number?: string

- PENSION (PensionMetadata)
  - plan_type?: string

- LOAN (LoanMetadata)
  - lender?: string
  - interest_rate?: decimal >= 0
  - credit_limit?: decimal >= 0
  - maturity_date?: YYYY-MM-DD

- CASH (CashMetadata)
  - location?: string

- VIRTUAL (VirtualMetadata)
  - note?: string

### Example metadata JSON

- BANK
```json
{
  "color": "#1f8f55",
  "external_ids": {"nh": "123-45-67890"},
  "institution_code": "NH",
  "account_number": "123-45-67890"
}
```

- CARD
```json
{
  "color": "#0055ff",
  "billing_cutoff_day": 15,
  "payment_day": 1,
  "auto_deduct": false,
  "settlement_account_ref": "NH 입출금 1234"
}
```

- POINT
```json
{ "provider_user_id": "npay:abcdef" }
```

## API endpoints (v2)

Base path: `/api/v2/accounts`

- POST `/validate` — Validate metadata for an account kind
  - Request: `{ "type": "CARD", "metadata": { ... } }`
  - Response: `{ "normalized": { ... } }` (types coerced, extra keys ignored)

- POST `/init-default` — Create a minimal default set
  - Creates if missing (idempotent): "기본 현금"(CASH), "기본 입출금"(BANK), "기본 신용카드"(CARD), "기본 카드 포인트"(POINT, parent=기본 신용카드)
  - Response: `AccountV2Out[]`

- Other CRUD
  - See `docs/account_model.md` section "AccountV2 API Endpoints" for list/get/create/put/patch/delete/tree.

### init-default usage

1) Call once after enabling AccountV2 to bootstrap common placeholders.

Example curl (optional):
```bash
curl -X POST http://127.0.0.1:8000/api/v2/accounts/init-default
```

Then fetch the tree:
```bash
curl http://127.0.0.1:8000/api/v2/accounts/tree
```

## Notes

- Validation only affects metadata shape; no cross-table linkage or balances are changed.
- All fields are optional by design; strictness can be increased per product when business rules are finalized.

## User Scoping

All AccountV2 APIs are scoped per user. Every account row carries a `user_id` and queries filter by the current user.

- Authentication dependency: a lightweight `get_current_user` is wired for now; tests can override it. In production, replace it with your real auth provider.
- Effects:
  - GET `/api/v2/accounts` returns only the caller's accounts.
  - GET `/api/v2/accounts/tree` builds a tree from the caller's accounts only.
  - POST `/api/v2/accounts/init-default` creates defaults only for the caller.
  - CRUD endpoints only read/write the caller's rows; 404 is returned for other users' ids.
