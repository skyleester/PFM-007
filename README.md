# Personal Finance Manager (FastAPI + Next.js)

Monorepo with:
- apps/backend: FastAPI + SQLAlchemy backend
- apps/web: Next.js (App Router) frontend

# Personal Finance Manager (PFM)

FastAPI + Next.js 15 기반 개인 가계부 모노레포입니다. 계좌/카테고리/거래 관리, 정기 규칙(Recurring), 대량 업로드, 신용카드 결제 주기, 전체 DB 백업/복구를 제공합니다.

## 주요 기능

- 계좌/카테고리/거래 CRUD와 강력한 이체 페어링
	- 카테고리 코드 규칙: Type(I/E/T)+GG(00-99)+CC(00-99), 00은 "미분류"
	- Bulk 업로드: BankSalad 엑셀(.xlsx) 지원, 계정/카테고리 자동 생성 및 멱등 업로드
	- 이체 자동 페어링(동일 일시/통화/절대금액 매칭) 및 중복방지
- 정기 규칙(Recurring)
	- 규칙 생성/수정/삭제, 프리뷰/발생(confirm), 과거 거래 연결(attach)
	- 반복 후보 스캔(주기/금액/메모 기반 그룹핑)과 “규칙 아님(배제)” 관리 탭
	- 후보 탭에서 개별/일괄 배제, 배제 탭에서 복원
- 신용카드 결제 주기
	- CREDIT_CARD 계좌: 마감일/결제일/연결계좌 필수, 월말 초과시 말일 스냅
	- 사용내역은 카드에 balance-neutral로 적재, 명세서(Statement)로 집계
	- 결제일에 연계 예금계좌에서 단일 지출 생성 후 명세서 paid 처리
- 전체 DB 백업/복원
	- SQLite WAL 인지 백업/복구, 메모/스냅샷 메타 저장(예: 카드 미결제 현황)
	- 선호 설정(Preferences)에서 생성/목록/다운로드/복원/삭제 UI 제공

## 모노레포 구성

- `apps/backend`: FastAPI + SQLAlchemy + Alembic (엔트리: `app/`)
- `apps/web`: Next.js 15 (App Router) + TypeScript + Tailwind CSS
- 루트: Makefile, `.venv`(권장), 공용 스크립트

## 빠른 시작 (개발)

필수: Python 3.11+, Node 18+.

1) Makefile로 한 번에 실행(권장)

```zsh
make dev
```

- 마이그레이션 적용 → 백엔드(8000) → /health 확인 → 프론트엔드(3000) 순서 실행

Windows (PowerShell)에서는 아래 스크립트를 사용할 수 있습니다:

```powershell
# PowerShell
scripts/dev-win.ps1

# 또는 프론트 없이 백엔드만
scripts/dev-win.ps1 -NoWeb
```

2) 수동 실행

```zsh
# backend
cd apps/backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
PYTHONPATH=. python -m alembic upgrade heads
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# web
cd ../../apps/web
npm install
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000 npm run dev
```

환경 변수

- `NEXT_PUBLIC_BACKEND_URL`(기본: `http://127.0.0.1:8000`)

## 마이그레이션 & 데이터베이스

- 개발 DB: SQLite (WAL, FK ON)
- Alembic 마이그레이션: 루트 Makefile로 자동 적용 또는 수동 실행

```zsh
cd apps/backend
PYTHONPATH=. .venv/bin/python -m alembic upgrade heads
```

## 개발 워크플로

- VS Code Tasks: "Run Backend" 등 제공
- Makefile 타겟
	- `make dev`: 백엔드+프론트 동시 기동
	- `make dev-backend`: 백엔드만 기동(적용/재시작 포함)
	- `make dev-web`: 프론트만 기동

## API 하이라이트

Recurring Rules
- `POST /api/recurring-rules`
- `GET /api/recurring-rules?user_id=...`
- `PATCH /api/recurring-rules/{id}` / `DELETE /api/recurring-rules/{id}`
- `GET /api/recurring-rules/{id}/preview?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `POST /api/recurring-rules/{id}/generate?start=YYYY-MM-DD&end=YYYY-MM-DD`

Recurring 후보 배제
- `POST /api/recurring/exclusions` — `{ user_id, signature_hash, snapshot }`
- `GET /api/recurring/exclusions?user_id=1&user_id=2`
- `DELETE /api/recurring/exclusions/{id}?user_id=...`
- 주의: 후보 스캔 응답에는 `signature_hash` 포함, 배제 목록의 해시는 스캔 결과에서 자동 제외

신용카드 명세서/결제
- `GET /api/accounts/{account_id}/credit-card-summary`
- `GET /api/accounts/{account_id}/credit-card-statements`
- `POST /api/credit-card-statements/{statement_id}/settle`

이체 페어링 규칙
- 동일 `occurred_at`/`occurred_time`/`currency`/`abs(amount)`인 전표는 한 번만 저장
- `transfer_flow` 힌트로 부호 결정, 외부로의 이동은 중립화하지 않고 잔액 반영

## 백업/복원 사용법

- 위치: 프론트엔드 “설정/환경설정(Preferences)”
- 기능: 전체 DB 백업 생성, 목록/다운로드, 메모 저장, 크레딧카드 미결제 스냅샷 메타 포함
- 복원: WAL-aware 복원, 진행 전 확인/안내, 멱등 체크(동일 백업 재복원 방지)
- 저장 위치: 레포 루트 `backups/` (개발)

## 테스트

백엔드
```zsh
cd apps/backend
PYTHONPATH=. .venv/bin/python -m pytest -q
```

프론트엔드
```zsh
cd apps/web
npm run lint
npm run test    # (필요 시)
```

## 트러블슈팅

- 프론트 빌드가 프리렌더에서 API를 호출하려는 경우: 해당 페이지를 dynamic 또는 client component로 전환
- API 호출 실패: 백엔드가 실행 중인지, `NEXT_PUBLIC_BACKEND_URL`이 올바른지 확인
- 마이그레이션 누락: `make dev-backend` 또는 Alembic 수동 실행으로 최신 스키마 적용
- favicon 오류: `apps/web/app/favicon.svg` 존재 확인(0바이트 .ico 지양)

## 참고

- 상세 코파일럿 가이드: `.github/copilot-instructions.md`
- 통계 페이지/캘린더 등 로드맵은 Copilot 가이드의 Roadmap 섹션 참조
Budget Summary
- GET /api/budgets/{budget_id}/summary
	- 반환: planned, spent(지출 절대값 합), remaining, execution_rate(%)

### 예시 (curl)

```sh
# 10일마다 수입 100 (KRW)
curl -X POST "http://127.0.0.1:8000/api/recurring-rules" \
	-H "Content-Type: application/json" \
	-d '{
		"user_id": 1,
		"name": "월급",
		"type": "INCOME",
		"frequency": "MONTHLY",
		"day_of_month": 10,
		"amount": 100,
		"currency": "KRW",
		"account_id": 1,
		"category_id": 1
	}'

# 2025 Q1 발생일 미리보기
curl "http://127.0.0.1:8000/api/recurring-rules/1/preview?start=2025-01-01&end=2025-03-31"

# 해당 범위 트랜잭션 생성(멱등)
curl -X POST "http://127.0.0.1:8000/api/recurring-rules/1/generate?start=2025-01-01&end=2025-03-31"

# 예산 요약 확인
curl "http://127.0.0.1:8000/api/budgets/1/summary"
```

## 문서
- DB 스키마 초안: `docs/schema.md`

## 세션 요약

- 모노레포 스캐폴드: FastAPI 백엔드 초기화, CORS, 헬스엔드포인트, Alembic 구성
- 모델/마이그레이션: 사용자/프로필, 계정, 카테고리 그룹/카테고리(코드 규칙 I/E/T+GG+CC), 트랜잭션(멱등성 external_id, transfer_group), 예산 등
- API: 계정/카테고리/트랜잭션/예산 CRUD, 이름 기반 생성(계정/카테고리), 이체 자동 쌍 생성, 잔액 반영(생성/삭제/수정), 필터/페이징, 정기 규칙/예산 요약
- 테스트: pytest + TestClient, 인메모리/임시 SQLite로 격리된 DB, 핵심 시나리오 100% 통과(17개)
- 개발 편의: VS Code Task로 Uvicorn 실행, /health 및 /api/* 엔드포인트 스모크 확인

## What’s new (2025-10-21)

- Recurring 매칭 개선 (백엔드)
	- 날짜를 회차 스케줄의 “가장 가까운 발생일(±7일)”로 스냅해 매칭/재지정 가능
	- 매칭 해제(detach) 및 발생일 건너뛰기(skip/unskip) 추가, pending 계산에서 제외
	- 500 회귀 수정: `_iter_occurrences` 제너레이터 복원, `_resolve_occurrence_date` 모듈 스코프로 이동

- Recurring 매칭 UX (프론트엔드)
	- 날짜 선택 + ±N일(0/3/7/14) 후보 조회, “이미 링크 포함” 토글 제공
	- 각 행에서 “이 거래로 매칭”/“링크 재지정”/“매칭 해제” 동작 지원
	- 스킵 패널(메모/복원)과 로컬 pending 즉시 필터링, 액션 후 부모 상태 리프레시

- 개발 편의
	- Windows PowerShell용 `scripts/dev-win.ps1` 추가(venv/Alembic/Uvicorn 통합)
	- `.vscode/tasks.json` 경미 수정
