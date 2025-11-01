# 데이터베이스 스키마 설계 (초안)

본 문서는 개인 가계부 애플리케이션의 백엔드 스키마 초안을 정의합니다. FastAPI + SQLAlchemy + Alembic 기반, 개발 기본 DB는 SQLite, 운영은 PostgreSQL을 권장합니다.

## 핵심 엔티티

- users: 사용자 계정(인증 주체)
- user_profiles: 사용자 프로필(표시 이름, 통화 기본값 등)
- accounts: 자산/부채 계정(예금/적금/대출/한도대출/퇴직연금/펀드/주식/암호화폐 등)
- category_groups: 대분류(수입/지출/이체 구분과 그룹명)
- categories: 소분류(대분류 하위)
- transactions: 거래(수입/지출/이체), 단일/분할 거래 지원 고려
- budgets: 예산(월별/카테고리별)

## 추천 추가 엔티티

- payees: 거래 상대(가맹점/수취인) 테이블
- tags: 태그(자유 분류) + transaction_tags (다대다)
- attachments: 첨부 파일 메타데이터(영수증 사진 등)
- recurring_rules: 반복 거래 규칙(크론/월간 N일/평일 등)
- currencies: 통화 목록(ISO 4217)
- exchange_rates: 환율 스냅샷(일별 기본)
- transfer_groups: 이체 거래 쌍을 묶는 그룹

## 카테고리 코드 규칙

- 형식: [Type][GG][CC]
  - Type: I(수입), E(지출), T(이체)
  - GG: 대분류 2자리 00~99 (00=미분류)
  - CC: 소분류 2자리 00~99 (00=미분류)
- 예: E0102 (지출-대분류 01-소분류 02 = 식비>배달)

## 테이블 정의(요약)

### users
- id (PK)
- email (unique, not null)
- password_hash
- created_at, updated_at
- is_active

### user_profiles
- id (PK)
- user_id (FK -> users.id, unique)
- display_name
- base_currency (e.g., KRW)
- locale, timezone
- created_at, updated_at

### accounts
- id (PK)
- user_id (FK -> users.id)
- name
- type (enum: DEPOSIT, SAVINGS, LOAN, CREDIT_LINE, RETIREMENT, FUND, STOCK, CRYPTO, OTHER)
- balance (numeric, 평가액)
- currency (FK -> currencies.code)
- is_archived (bool)
- created_at, updated_at

### category_groups (대분류)
- id (PK)
- user_id (FK -> users.id) — 기본 템플릿도 지원 가능
- type (enum: I, E, T)
- code_gg (00~99)
- name
- sort_order (int)
- unique(user_id, type, code_gg)

### categories (소분류)
- id (PK)
- user_id (FK -> users.id)
- group_id (FK -> category_groups.id)
- code_cc (00~99)
- name
- sort_order (int)
- full_code (generated/computed: Type + GG + CC)
- unique(user_id, group_id, code_cc)
- unique(user_id, full_code)

### transactions
- id (PK)
- user_id (FK -> users.id)
- occurred_at (date)
- occurred_time (time, nullable)
- type (enum: INCOME, EXPENSE, TRANSFER)
- group_id (nullable, FK -> transfer_groups.id)
- account_id (FK -> accounts.id)
- counter_account_id (nullable, FK -> accounts.id) — 이체시 사용
- category_id (nullable, FK -> categories.id)
- amount (numeric, not null, 소수 2~4 자리)
- currency (FK -> currencies.code)
- memo (text)
- payee_id (nullable, FK -> payees.id)
- created_at, updated_at
- 제약: TRANSFER일 때 amount는 +/-, account/counter_account 필수, category_id는 null

### budgets
- id (PK)
- user_id (FK -> users.id)
- period (enum: MONTH, WEEK, CUSTOM)
- period_start, period_end (date)
- category_id (nullable)
- account_id (nullable) — 계정 기반 예산 케이스
- amount (numeric)
- currency
- rollover (bool)
- created_at, updated_at

### payees, tags, transaction_tags, attachments, recurring_rules, currencies, exchange_rates, transfer_groups
- 표준 필드(id, user_id, created_at 등) 포함. 상세는 구현 시 스키마로 확정.

## 인덱스/성능
- transactions(user_id, occurred_at desc)
- transactions(user_id, type, occurred_at)
- categories(user_id, full_code)
- accounts(user_id, type)

## 시드 권장
- 카테고리: 각 type 별 00(미분류) 기본 생성 (E0000, I0000, T0000)
- 예시: E01 식비, E0101 외식, E0102 배달, E02 여가/문화, E0201 영화, E0202 공연, E03 공과금, E0301 전기, E0302 가스

## 마이그레이션 가이드
- Alembic으로 초기 스키마 생성 후, enum/type 변경은 신규 enum 생성 + 컬럼 캐스트 전략 사용(Postgres).
