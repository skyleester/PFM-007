# Bulk Upload Process 분석 문서

> **작성일**: 2025-10-20  
> **목적**: Transaction bulk upload 전체 프로세스를 분석하고 개선이 필요한 지점을 식별하기 위한 참고 자료

---

## 1. 개요

현재 Personal Finance Manager는 BankSalad 앱에서 내보낸 엑셀 파일(.xlsx)을 통해 거래 내역을 대량으로 업로드할 수 있습니다. 이 프로세스는 다음 3단계로 구성됩니다:

1. **프론트엔드**: 사용자가 파일을 선택하고 옵션을 설정
2. **파싱 레이어**: 엑셀 데이터를 트랜잭션 형식으로 변환
3. **백엔드 API**: 데이터를 검증하고 데이터베이스에 저장

---

## 2. 전체 데이터 플로우

```
사용자 파일 선택
    ↓
BulkUploadModal (apps/web/app/transactions/page.tsx)
    ↓
parseBankSaladWorkbook (apps/web/lib/importers/banksalad.ts)
    ├─ 엑셀 시트 읽기 (XLSX.read)
    ├─ 헤더 컬럼 매핑
    ├─ 각 행을 TransactionCreate 형식으로 변환
    │   ├─ 날짜/시간 파싱
    │   ├─ 유형(INCOME/EXPENSE/TRANSFER) 판별
    │   ├─ 금액 정규화
    │   ├─ 계좌/카테고리 매핑
    │   └─ 이체 방향성(transfer_flow) 추론
    ├─ 단일 계좌 원장 모드 처리
    │   └─ 특정 계좌 중심 전표 생성, 이체 → 수입/지출 강등
    └─ 이체 페어링 (pendingTransfers 로직)
        └─ 동일 날짜+시간+금액(절대값)+통화로 OUT/IN 짝 찾기
    ↓
API 호출: POST /api/transactions/bulk
    ↓
bulk_upsert_transactions (apps/backend/app/routers.py)
    ├─ 사용자 존재 확인
    ├─ normalized: TransactionCreate[] 정규화
    ├─ transfer_dt_groups: (date, time, currency) 키로 이체 그룹화
    ├─ pair_transfers_tolerant: ±2원 허용 페어링
    │   ├─ account/counter 정보 대칭 확인
    │   ├─ transfer_flow 힌트 활용
    │   └─ 짝이 맞으면 단일 TRANSFER로 병합
    ├─ override 모드: external_id 기준 기존 레코드 삭제
    ├─ settlement 중복 감지 (billing_cycle_id 체크)
    └─ create_transaction: DB INSERT + 잔액 갱신
    ↓
저장된 트랜잭션 목록 반환
    ↓
프론트엔드 리프레시
```

---

## 3. 주요 컴포넌트 상세

### 3.1 프론트엔드: BulkUploadModal

**파일**: `apps/web/app/transactions/page.tsx` (L1845-2130)

**주요 기능**:
- 파일 선택 UI 제공
- 멤버 선택 (user_id 1 또는 2)
- **단일 계좌 원장 모드** 토글:
  - 기본값: `true` (최근 요청사항 반영)
  - 활성화 시: 모든 전표의 `account_name`을 특정 계좌로 고정
  - 주 계좌명 자동 감지: 엑셀 시트에서 80% 이상 비중 차지 시 자동 활성화
- 파싱 결과 미리보기 (상위 10건)
- override 옵션: external_id 중복 시 기존 레코드 대체
- detectedAccounts: 엑셀에서 추출한 계좌 목록을 datalist로 제공

**상태 관리**:
```typescript
const [selectedMemberId, setSelectedMemberId] = useState<number>(1);
const [singleAccountMode, setSingleAccountMode] = useState(true); // 기본 활성화
const [primaryAccountName, setPrimaryAccountName] = useState("");
const [detectedAccounts, setDetectedAccounts] = useState<string[]>([]);
const [parseResult, setParseResult] = useState<BankSaladParseResult | null>(null);
```

**라이브 재파싱**:
- `singleAccountMode`, `primaryAccountName`, `selectedMemberId` 변경 시 자동으로 파서 재실행
- lastBufferRef로 원본 ArrayBuffer 보관하여 파일 재선택 없이 재파싱

---

### 3.2 파싱 레이어: parseBankSaladWorkbook

**파일**: `apps/web/lib/importers/banksalad.ts` (L426-981)

#### 3.2.1 시트 구조 파악

```typescript
const SHEET_NAME = "가계부 내역";
```

- BankSalad 엑셀 파일의 2번째 시트 또는 "가계부 내역" 이름을 가진 시트 사용
- 빈 행이 있을 경우 자동으로 건너뛰며 헤더 행 탐색

#### 3.2.2 컬럼 매핑 시스템

```typescript
const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  date: ["날짜", "date", "거래일", "일자"],
  time: ["시간", "time"],
  type: ["분류", "type", "유형", "거래유형", "거래분류", "타입"],
  group: ["대분류", "카테고리대분류", "거래대분류", "중분류", "그룹"],
  category: ["소분류", "카테고리", "카테고리소분류", "상세분류", "세부분류", ...],
  content: ["내용", "내역", "상세내용", "거래처", "거래내역", "상세", "적요"],
  amount: ["금액", "거래금액", "금액원", "amount", "합계", "총금액"],
  currency: ["통화", "currency", "화폐"],
  account: ["결제수단", "계좌", "계좌명", "자산", "사용자산", "수단"],
  memo: ["메모", "비고", "설명", "노트"],
  income: ["입금", "입금금액", "입금액", "수입", "income"],
  expense: ["출금", "출금금액", "출금액", "지출", "expense"],
  sourceAccount: ["출금자산", "출금계좌", "출금수단", "보낸자산", "보낸계좌"],
  targetAccount: ["입금자산", "입금계좌", "입금수단", "받은자산", "받은계좌"],
};
```

- **정규화 전략**: 헤더명에서 괄호/대괄호 제거, 공백 제거, 소문자 변환
- **폴백 인덱스**: 헤더가 없거나 매칭 실패 시 고정 컬럼 위치 사용

#### 3.2.3 날짜/시간 파싱

**parseExcelDate**:
- Excel 날짜 시리얼 번호 → Date 객체
- 문자열 형식: "2024-01-15", "2024년 1월 15일", "2024.01.15" 등 지원
- UTC 기준으로 변환하여 시간대 문제 방지

**parseExcelTime**:
- Excel 시간 시리얼 번호 → "HH:MM:SS" 문자열
- "오전/오후", "AM/PM" 표기 지원
- 기본값: "09:00:00"

#### 3.2.4 금액 처리

```typescript
function parseAmount(value: unknown): number | null {
  // 숫자 타입은 그대로, 문자열은 쉼표/통화기호 제거 후 변환
  const sanitized = value.replace(/[ ,\s]/g, "").replace(/[원₩]/g, "");
  return Number.isFinite(num) ? num : null;
}
```

**금액 부호 판정**:
1. `rawAmount` 우선
2. 없으면 `incomeAmount` / `expenseAmount` 컬럼 확인
3. EXPENSE는 음수로, INCOME은 양수로 변환
4. TRANSFER는 절대값 사용 (방향은 transfer_flow로 표현)

#### 3.2.5 단일 계좌 원장 모드

**자동 활성화 조건**:
```typescript
// 특정 계좌가 전체 행의 80% 이상을 차지하면 자동 활성화
if (bestKey && total > 0 && best / total >= 0.8) {
  primaryAccountName = matched ?? bestRaw;
  rawSingleAccountMode = true;
}
```

**동작 방식**:
- `singleModeForRow = true`인 경우:
  - 모든 전표의 `account_name`을 `primaryAccountName`으로 고정
  - TRANSFER 유형:
    - **잔액중립 패턴** (카드대금, 내계좌이체 등) → TRANSFER 유지, counter_account 없이 단일 전표
    - **외부 이체** → EXPENSE/INCOME으로 강등
      - OUT 방향 (expenseAmount > 0 또는 음수 금액) → EXPENSE
      - IN 방향 (incomeAmount > 0 또는 양수 금액) → INCOME
      - `transfer_flow` 메타데이터 보존 (향후 복원 가능)
  - INCOME/EXPENSE는 그대로 통과

**잔액중립 패턴 판별**:
```typescript
const DEFAULT_NEUTRAL_PATTERNS = {
  group: ["내계좌이체", "이체"],
  category: ["카드대금", "카드 결제", "신용카드대금", "카드대금결제"],
  memo: ["카드대금", "카드 결제", "결제대금", "신용카드"],
  content: ["카드대금", "카드 결제", "결제대금", "신용카드"],
};
```
- 대분류/소분류/메모/내용 중 하나라도 패턴에 매칭되면 잔액중립 이체로 간주

#### 3.2.6 이체 페어링 로직 (프론트엔드 단계)

**1차 명시적 매칭**:
- `sourceAccount`, `targetAccount` 컬럼이 명시되어 있고
- `existingAccounts`와 정확 매칭되면 즉시 TRANSFER 확정
- 중복 방지를 위해 dedupKey 등록: `날짜::시간::금액::계좌페어`

**2차 페어링 (pendingTransfers)**:
- 명시적 매칭 실패한 TRANSFER들을 보류 목록에 추가
- 날짜+시간+금액(절대값)+통화가 동일한 그룹으로 묶기
- OUT(음수)/IN(양수) 분류
- 각 OUT을 IN과 1:1 매칭:
  - 계좌명이 다르면 → 내부 이체로 단일 TRANSFER 생성
  - 계좌명이 같으면 → 의미 없는 상쇄, 각각 EXPENSE/INCOME으로 강등
- 짝이 없는 항목 → 외부 유출/유입으로 EXPENSE/INCOME 강등

**예시**:
```
Row 10: TRANSFER, -50000, 계좌A, 시간 14:00
Row 15: TRANSFER, +50000, 계좌B, 시간 14:00
→ 단일 TRANSFER 생성: account=계좌A, counter_account=계좌B, amount=-50000
```

#### 3.2.7 계좌명 정규화와 매칭

```typescript
function normalizeAccountKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase();
}
```

- Unicode 정규화 + 공백/구두점/기호 제거 + 소문자 변환
- `existingAccounts` 배열을 정규화 맵으로 변환하여 빠른 조회
- 매칭 성공 시 기존 계좌명 사용, 실패 시 엑셀 원본명 사용

---

### 3.3 백엔드 API: POST /api/transactions/bulk

**파일**: `apps/backend/app/routers.py` (L3170-3630)

#### 3.3.1 요청 페이로드

```python
class TransactionsBulkIn(BaseModel):
    user_id: int
    override: bool = False
    items: list[TransactionCreate]

class TransactionCreate(BaseModel):
    user_id: int
    occurred_at: str  # YYYY-MM-DD
    occurred_time: str | None = None
    type: TxnType  # INCOME | EXPENSE | TRANSFER
    amount: float
    currency: str
    account_id: int | None = None
    account_name: str | None = None
    counter_account_id: int | None = None
    counter_account_name: str | None = None
    category_id: int | None = None
    category_group_name: str | None = None
    category_name: str | None = None
    memo: str | None = None
    external_id: str | None = None
    transfer_flow: Literal["OUT", "IN"] | None = None
    billing_cycle_id: int | None = None
    # ... 기타 필드
```

#### 3.3.2 처리 파이프라인

**1단계: 사용자 검증**
```python
user = db.query(models.User).filter(models.User.id == payload.user_id).first()
if not user:
    raise HTTPException(status_code=400, detail="User not found for bulk upload")
```

**2단계: TRANSFER 그룹화**
```python
transfer_dt_groups: dict[tuple, list[TransactionCreate]] = {}
for item in normalized:
    if item.type == models.TxnType.TRANSFER:
        k = (item.occurred_at, item.occurred_time, (item.currency or "").upper())
        transfer_dt_groups.setdefault(k, []).append(item)
```

**3단계: 이체 페어링 (±2원 허용)**

`pair_transfers_tolerant` 함수:
- 프론트엔드에서 완벽히 매칭되지 않은 TRANSFER들을 재시도
- 금액 절대값 차이 ±2원 이내 허용 (반올림 오차 대응)
- 방향성 추론 우선순위:
  1. `transfer_flow` 명시적 힌트
  2. `account` ↔ `counter_account` 대칭성
  3. `counter_account_id` / `counter_account_name` 존재 여부
- 스코어 기반 최적 매칭:
  ```python
  score = 0
  if entry_counter_key(a) == entry_account_key(b):
      score += 2  # 계좌-상대계좌 대칭
  if a.transfer_flow == "OUT" and b.transfer_flow == "IN":
      score += 1  # 방향 보완
  ```

**4단계: override 모드 처리**
```python
if payload.override:
    ext_ids = {item.external_id for item in normalized if item.external_id}
    existing = db.query(Transaction).filter(
        Transaction.user_id == payload.user_id,
        Transaction.external_id.in_(ext_ids)
    ).all()
    # 기존 레코드와 그 그룹 멤버 모두 삭제 + 잔액 복구
```

**5단계: 중복 감지**

- **Settlement 중복**:
  ```python
  if item.type == TxnType.SETTLEMENT and item.billing_cycle_id is not None:
      stmt = db.query(CreditCardStatement).filter_by(id=item.billing_cycle_id).first()
      if stmt and (stmt.status == "PAID" or stmt.settlement_transaction_id):
          settlement_duplicates += 1
          continue
  ```

**6단계: 트랜잭션 생성**

```python
for item, auto_match in filtered_to_create:
    balance_neutral = (
        item.type == TxnType.TRANSFER
        and not item.counter_account_id
        and not item.counter_account_name
    )
    created_tx = create_transaction(
        item, db,
        balance_neutral=balance_neutral,
        auto_transfer_match=auto_match
    )
```

- `balance_neutral=True`: 잔액에 영향 안 줌 (단일 계좌 원장 모드의 잔액중립 이체)
- `auto_transfer_match=True`: 페어링으로 병합된 이체 (UI에서 특별 표시)
- `create_transaction`:
  - 계좌/카테고리 자동 생성 (이름만 제공된 경우)
  - 잔액 갱신 (`_apply_balance`)
  - 자동이체 전표는 양 계좌 잔액 동시 갱신 (`_revert_single_transfer_effect`)

---

## 4. 현재 구현의 장점

### 4.1 유연한 컬럼 매핑
- 다양한 엑셀 형식 지원 (컬럼명 alias 배열)
- 헤더 없는 파일도 폴백 인덱스로 처리 가능

### 4.2 지능형 이체 페어링
- 프론트엔드 1차 매칭 + 백엔드 2차 허용 페어링
- ±2원 허용으로 반올림 오차 흡수
- 계좌 대칭성, 방향 힌트 기반 스코어링

### 4.3 단일 계좌 원장 모드
- 자동 감지 (80% 임계값)
- 사용자가 특정 계좌 중심으로 장부 관리 가능
- 이체 → 수입/지출 강등으로 복식 부기 부담 경감

### 4.4 중복 방지
- `external_id` 기반 override 모드
- settlement 중복 감지 (billing_cycle_id)
- dedupKey로 동일 이체 중복 업로드 방지

### 4.5 실시간 미리보기
- 파일 선택 즉시 파싱 결과 표시
- 옵션 변경 시 라이브 재파싱 (파일 재선택 불필요)

---

## 5. 식별된 문제점 및 개선 포인트

### 5.1 파싱 레이어 복잡도

**문제**:
- `parseBankSaladWorkbook` 함수가 550줄 이상의 단일 함수
- 단일 계좌 모드, 페어링, 강등 로직이 중첩되어 가독성 저하
- 에러 처리가 `issues` 배열에 문자열로 축적되어 구조적 분석 어려움

**개선 방안**:
```typescript
// 제안: 파싱 파이프라인 분리
class BankSaladParser {
  private workbook: XLSX.WorkBook;
  private options: BankSaladParseOptions;
  private issues: ParseIssue[] = []; // { row: number, field: string, message: string }
  
  parse(): BankSaladParseResult {
    const sheet = this.findSheet();
    const columnMap = this.buildColumnMap(sheet);
    const rows = this.extractRows(sheet);
    
    const rawItems = rows.map(row => this.parseRow(row, columnMap));
    const normalized = this.applySingleAccountMode(rawItems);
    const paired = this.pairTransfers(normalized);
    
    return { items: paired, issues: this.issues, summary: this.buildSummary(paired) };
  }
  
  private parseRow(row: unknown[], map: ColumnMap): RawTransactionItem | null {
    // 개별 필드 파싱 + validation
  }
  
  private applySingleAccountMode(items: RawTransactionItem[]): TransactionItem[] {
    // 단일 계좌 모드 로직만 집중
  }
  
  private pairTransfers(items: TransactionItem[]): BulkTransactionInput[] {
    // 페어링 로직만 집중
  }
}
```

### 5.2 계좌 자동 감지 신뢰성

**문제**:
- 80% 임계값이 하드코딩되어 있어 엣지 케이스(예: 2개 계좌가 각각 45%, 40%) 처리 불명확
- 여러 계좌를 골고루 사용하는 사용자는 의도와 다르게 단일 모드 활성화될 수 있음

**개선 방안**:
- 임계값을 옵션으로 노출: `{ autoDetectThreshold: 0.8 }`
- 상위 2개 계좌 비율 차이가 일정 이하면 자동 감지 비활성화
- UI에서 감지 결과를 명시적으로 표시하고 사용자가 확인/변경 가능하도록

### 5.3 이체 페어링 우선순위 불명확

**문제**:
- 프론트엔드 `pendingTransfers` 페어링과 백엔드 `pair_transfers_tolerant`가 비슷한 로직을 중복 수행
- 두 단계에서 다른 결과가 나올 수 있음 (특히 ±2원 허용 범위)
- 3개 이상의 동일 시각/금액 이체가 있을 때 어떤 것끼리 짝을 맺을지 비결정적

**개선 방안**:
- 백엔드 페어링을 "최종 안전망"으로만 사용하고, 프론트엔드에서 명확한 페어링 완료
- 또는 파싱을 완전히 백엔드로 이동 (엑셀 파일 업로드 → 백엔드 파싱)
  - 장점: 로직 단일화, 서버 사이드 validation 강화
  - 단점: 프론트엔드 미리보기 지연, 파일 크기 제약
- **타임스탬프 정밀도 개선**: 동일 금액 이체가 많을 경우 초 단위 시간까지 매칭

### 5.4 카테고리/계좌 자동 생성의 일관성

**문제**:
- 백엔드 `create_transaction`에서 카테고리/계좌를 on-the-fly 생성
- 카테고리 코드 자동 할당 로직이 복잡 (GG00-99, CC00-99)
- 사용자가 나중에 병합/정리하기 어려움 (예: "식비" vs "식비 ")

**개선 방안**:
- 파싱 단계에서 카테고리/계좌명을 정규화 (트림, 공백 통일)
- 백엔드에서 유사 이름 감지 후 사용자에게 병합 제안
- 대량 업로드 후 "새로 생성된 계좌/카테고리 검토" 단계 추가

### 5.5 에러 피드백 개선

**문제**:
- 파싱 실패 시 `issues` 배열에 텍스트만 저장
- 사용자가 어떤 행이 문제인지 알 수 있지만, 수정 방법은 불명확
- 예: "R150: 금액을 해석할 수 없습니다." → 어떤 값이 들어있었는지 모름

**개선 방안**:
```typescript
type ParseIssue = {
  rowIndex: number;
  field: string; // "amount", "date", "account" 등
  rawValue: unknown; // 원본 셀 값
  message: string;
  severity: "error" | "warning"; // warning은 기본값으로 진행
};
```
- UI에서 이슈별로 필터링/정렬 가능
- "모든 에러 수정 후 재시도" vs "경고 무시하고 업로드" 선택지

### 5.6 대용량 파일 처리

**문제**:
- 프론트엔드에서 모든 파싱 수행 → 5000건 이상 시 브라우저 부담
- 미리보기는 10건만 표시하지만, 전체 파싱은 매번 수행

**개선 방안**:
- Web Worker로 파싱 로직 이동 (UI 블로킹 방지)
- 페이지네이션: 1000건씩 분할 파싱/업로드
- 백엔드 스트리밍 업로드: 청크 단위로 전송 → 서버에서 병렬 처리

### 5.7 단일 계좌 모드 강등 복원

**문제**:
- 이체 → 수입/지출 강등 시 `transfer_flow` 메타데이터 보존하지만 활용 X
- 사용자가 나중에 "이건 사실 이체였어" 하고 복원하려면 수동 편집 필요

**개선 방안**:
- UI에 "강등된 이체 복원" 도구 추가
- `transfer_flow` 있는 INCOME/EXPENSE를 필터링하여 batch 복원
- 또는 업로드 시 "이체 강등 미리보기" 단계에서 사용자 확인

### 5.8 이체 방향성 추론 휴리스틱 개선

**문제**:
- `transfer_flow` 결정이 여러 조건에 의존 (expenseAmount, incomeAmount, 원본 금액 부호)
- 조건 우선순위가 코드로만 존재 → 예상과 다른 결과 시 디버깅 어려움

**개선 방안**:
- 방향성 추론 로직을 독립 함수로 분리 + 테스트 케이스 추가
- 파싱 결과에 `flow_inference_reason` 메타데이터 포함 (UI 디버그 모드에서 표시)
- 사용자가 직접 방향 지정할 수 있는 고급 옵션 제공

### 5.9 중복 감지 로직 확장

**문제**:
- 현재는 `external_id` 기반 중복만 감지
- 같은 날짜/금액/계좌/카테고리가 여러 번 업로드되면 진짜 중복인지 판단 불가

**개선 방안**:
- 휴리스틱 중복 감지: (날짜 ± 1일) & 금액 & 계좌 & 카테고리 일치 → 의심 플래그
- 업로드 전 "기존 거래와 유사한 항목 N건 발견" 경고
- 사용자가 "새 거래로 추가" vs "기존 거래 덮어쓰기" 선택

### 5.10 통화 변환 지원 부족

**문제**:
- 현재는 `currency` 필드만 저장하고 실제 환율 적용 안 함
- 외화 거래 시 원화 환산 금액을 수동 입력해야 함

**개선 방안**:
- `exchangeRates` 테이블 활용하여 파싱 시점 환율 자동 적용
- 사용자가 "외화 그대로" vs "원화 환산" 선택할 수 있는 옵션
- 환율 적용 이력을 메타데이터로 저장 (나중에 재환산 가능)

---

## 6. 테스트 케이스 시나리오

현재 테스트 커버리지를 확장하기 위한 핵심 시나리오:

### 6.1 단일 계좌 모드 시나리오
```
Given: 엑셀에 "저축예금 84607"이 90% 비중
When: 파일 업로드
Then: 자동으로 단일 계좌 모드 활성화, primaryAccountName = "저축예금 84607"

Given: 이체 행 (카드대금)
When: 단일 계좌 모드 활성화
Then: TRANSFER 유지, counter_account 없음, balance_neutral=true

Given: 이체 행 (외부 송금)
When: 단일 계좌 모드 활성화
Then: EXPENSE로 강등, transfer_flow="OUT" 보존
```

### 6.2 페어링 시나리오
```
Given: 
  Row A: TRANSFER, -100000, 계좌1, 2024-01-15 14:00
  Row B: TRANSFER, +100000, 계좌2, 2024-01-15 14:00
When: 파싱 완료
Then: 단일 TRANSFER 생성 (account=계좌1, counter=계좌2, amount=-100000, auto_match=true)

Given: 
  Row A: TRANSFER, -100000, 계좌1, 2024-01-15 14:00
  Row B: TRANSFER, +100002, 계좌2, 2024-01-15 14:00 (2원 차이)
When: 백엔드 페어링 (tol=2)
Then: 단일 TRANSFER 생성 (amount=-100000 사용)

Given: 
  Row A: TRANSFER, -100000, 계좌1, 2024-01-15 14:00
  Row B: TRANSFER, +100000, 계좌1, 2024-01-15 14:00 (동일 계좌)
When: 페어링 시도
Then: 각각 EXPENSE(-100000), INCOME(+100000)으로 강등
```

### 6.3 에러 처리 시나리오
```
Given: 날짜 컬럼에 "invalid" 텍스트
When: 파싱 시도
Then: issues 배열에 "R{N}: 날짜를 해석할 수 없습니다." 추가, 해당 행 스킵

Given: 금액 컬럼 비어있음
When: 파싱 시도
Then: issues 배열에 에러 추가, 다음 행 계속 처리

Given: 계좌명이 빈 문자열
When: 파싱 완료
Then: DEFAULT_ACCOUNT ("기타 결제수단") 사용
```

### 6.4 Override 모드 시나리오
```
Given: 
  기존 트랜잭션: external_id="banksalad-20240115-10-50000"
  새 업로드: external_id="banksalad-20240115-10-50000", 금액 변경
When: override=true
Then: 기존 레코드 삭제 후 새 레코드 생성, 잔액 재계산

Given: 
  기존 트랜잭션의 group_id=100
  같은 group_id의 다른 레코드 존재
When: override=true로 삭제 시도
Then: 그룹 전체 삭제 + 모든 잔액 복구
```

---

## 7. 추천 개선 로드맵

### Phase 1: 안정성 강화 (단기)
1. 에러 메시지 구조화 (`ParseIssue` 타입 도입)
2. 파싱 로직 단위 테스트 추가 (날짜/금액/계좌명 파싱)
3. 계좌/카테고리명 정규화 강화 (트림, 공백 통일)
4. 백엔드 페어링 로직 테스트 커버리지 확대

### Phase 2: 사용성 개선 (중기)
1. 파싱 파이프라인 클래스화 (가독성 향상)
2. 자동 감지 임계값 설정 노출
3. 이체 방향성 추론 디버그 모드 추가
4. 휴리스틱 중복 감지 구현

### Phase 3: 성능 최적화 (중기)
1. Web Worker 파싱 이동
2. 대용량 파일 청크 업로드
3. 백엔드 스트리밍 처리

### Phase 4: 고급 기능 (장기)
1. 환율 자동 적용
2. 강등된 이체 복원 도구
3. 유사 카테고리/계좌 병합 제안
4. 다른 가계부 앱 포맷 지원 확장

---

## 8. 참고 코드 위치

### 프론트엔드
- **BulkUploadModal**: `apps/web/app/transactions/page.tsx` L1845-2130
- **parseBankSaladWorkbook**: `apps/web/lib/importers/banksalad.ts` L426-981
- **API 호출**: `apps/web/app/transactions/page.tsx` L1955

### 백엔드
- **bulk_upsert_transactions**: `apps/backend/app/routers.py` L3170-3630
- **pair_transfers**: `apps/backend/app/routers.py` L3198-3340
- **pair_transfers_tolerant**: `apps/backend/app/routers.py` L3390-3540
- **create_transaction**: (별도 모듈, routers.py에서 호출)

### 테스트
- `apps/backend/tests/test_api_basic.py`: bulk upload 기본 시나리오
- `apps/backend/tests/test_bulk_update.py`: bulk update 로직

---

## 9. 결론

현재 bulk upload 프로세스는 **유연한 파싱 + 지능형 페어링 + 단일 계좌 모드**라는 3가지 강점을 가지고 있습니다. 하지만 다음 이슈들이 개선 대상입니다:

1. **복잡도 관리**: 550줄 단일 함수를 모듈화된 파이프라인으로 분리
2. **에러 피드백**: 구조화된 이슈 타입 + 수정 가이드
3. **페어링 신뢰성**: 프론트/백엔드 로직 통합 또는 역할 명확화
4. **대용량 처리**: Web Worker + 청크 업로드
5. **사용자 확인**: 자동 감지 결과 명시, 중복 경고, 강등 복원

위 개선안을 단계적으로 적용하면 더 안정적이고 직관적인 bulk upload 경험을 제공할 수 있습니다.
