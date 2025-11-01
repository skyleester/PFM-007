# Bulk Upload 이체 타입 보존 개선 (2025-10-20)

## 🔴 문제 상황

BankSalad 엑셀 파일에서 **타입이 "이체"인 거래**가 업로드 후:
- ❌ 유형이 **"수입" 또는 "지출"**로 변경됨
- ❌ 카테고리는 **"이체"** 그대로 유지
- ❌ 통계 페이지에서 **"이체 제외" 체크해도 계산에 포함됨**

### 근본 원인

1. **단일 계좌 모드 자동 활성화**: 특정 계좌가 80% 이상 비중 → 자동으로 활성화
2. **TRANSFER → INCOME/EXPENSE 강등**: 단일 모드에서 페어링 실패 시 타입 변경
3. **카테고리 보존**: 강등 시 원본 엑셀의 "이체" 카테고리 그대로 사용
4. **통계 필터 무력화**: 백엔드는 `type == TRANSFER`만 제외하므로, INCOME/EXPENSE + "이체" 카테고리는 통과

### 예시

```
엑셀 원본:
날짜: 2024-01-15
타입: 이체
금액: 100,000
대분류: 이체
소분류: 계좌이체

↓ (기존 로직)

저장된 데이터:
type: "INCOME"  ← 잘못됨!
category_group_name: "이체"
category_name: "계좌이체"

↓ (통계 계산)

백엔드 필터:
if txn.type == TRANSFER: skip  ← INCOME이므로 통과!
→ 수입 100,000원으로 통계에 포함됨 😱
```

---

## ✅ 적용한 해결책

### 1. 단일 계좌 모드 기본값 변경

**파일**: `apps/web/app/transactions/page.tsx`

```typescript
// 변경 전
const [singleAccountMode, setSingleAccountMode] = useState(true);

// 변경 후
const [singleAccountMode, setSingleAccountMode] = useState(false);
```

**이유**: 대부분의 사용자는 일반 모드를 원함. 특수한 경우만 수동으로 활성화.

---

### 2. 자동 활성화 로직 제거

**파일**: `apps/web/lib/importers/banksalad.ts`

```typescript
// 기존: 80% 임계값으로 자동 활성화
if (bestKey && total > 0 && best / total >= 0.8) {
  primaryAccountName = matched ?? bestRaw;
  rawSingleAccountMode = true; // 자동 활성화
}

// 변경: 주석 처리하여 완전히 비활성화
/*
if (!primaryAccountName) {
  // ... 자동 감지 로직 ...
  rawSingleAccountMode = true;
}
*/
```

**이유**: 
- 의도치 않은 타입 변환 방지
- 사용자 명시적 선택만 허용
- 이체 타입 보존 우선

---

### 3. 강등 시 카테고리 처리 개선

**파일**: `apps/web/lib/importers/banksalad.ts` (L645-665)

```typescript
// 기존: 엑셀 카테고리 무조건 사용
category_group_name: groupText || dgGroup,
category_name: categoryText || dgCategory,

// 변경: "이체" 카테고리 제외
const shouldUseOriginalCategory = 
  groupText && 
  categoryText && 
  !["이체", "내계좌이체", "계좌이체", "transfer"].includes(
    categoryText.toLowerCase().replace(/\s+/g, "")
  );

category_group_name: shouldUseOriginalCategory ? groupText : dgGroup,
category_name: shouldUseOriginalCategory ? categoryText : dgCategory,
```

**효과**:
- TRANSFER → INCOME/EXPENSE 강등 시 "이체" 카테고리 사용 안 함
- 대신 "기타 수입" / "미분류 수입" 등 기본값 사용
- 통계 오염 방지

---

### 4. 페어링 실패 시에도 TRANSFER 타입 유지 ⭐

**파일**: `apps/web/lib/importers/banksalad.ts` (L880-975)

가장 중요한 변경! 3곳 수정:

#### 4-1. 짝이 없는 단독 항목

```typescript
// 기존: EXPENSE/INCOME으로 강등
const downgradedType: TxnType = single.amount < 0 ? "EXPENSE" : "INCOME";
type: downgradedType,

// 변경: TRANSFER 타입 유지
type: "TRANSFER",
category_group_name: fallbackCategory,
category_name: fallbackName,
```

#### 4-2. 동일 계좌 간 이체

```typescript
// 기존: 의미 없는 상쇄로 각각 강등
const downgradedType: TxnType = single.amount < 0 ? "EXPENSE" : "INCOME";

// 변경: TRANSFER 유지
type: "TRANSFER",
// counter 없이 단일 전표로 처리
```

#### 4-3. 페어링 후 남은 항목

```typescript
// 기존: leftovers를 EXPENSE/INCOME으로 강등
const downgradedType: TxnType = single.amount < 0 ? "EXPENSE" : "INCOME";

// 변경: TRANSFER 유지
type: "TRANSFER",
transfer_flow: single.amount < 0 ? "OUT" : "IN",
```

**핵심 철학 변경**:
```
기존: 엑셀에 "이체"라고 써있어도 페어링 실패하면 수입/지출로 간주
새로: 엑셀에 "이체"라고 써있으면 무조건 TRANSFER 타입으로 저장
```

---

## 🎯 개선 효과

### Before (문제 발생)

```typescript
// 엑셀: 타입=이체, 금액=100,000
// 저장 결과:
{
  type: "INCOME",           // ❌ 잘못됨
  amount: 100000,
  category_name: "이체"     // ❌ 모순
}

// 통계 계산:
if (type == "TRANSFER") skip;  // INCOME이므로 통과!
→ 수입 +100,000 잘못 집계
```

### After (해결)

```typescript
// 엑셀: 타입=이체, 금액=100,000
// 저장 결과:
{
  type: "TRANSFER",        // ✅ 올바름
  amount: 100000,
  category_name: "계좌이체"
  // counter_account 없으면 단방향 이체로 처리
}

// 통계 계산:
if (type == "TRANSFER") skip;  // ✅ 제대로 제외됨
→ 통계에 영향 없음
```

---

## 📊 영향 범위

### 변경된 파일

1. **`apps/web/app/transactions/page.tsx`**
   - 단일 계좌 모드 기본값: `true` → `false`

2. **`apps/web/lib/importers/banksalad.ts`**
   - 자동 활성화 로직 주석 처리 (L460-485)
   - 강등 시 카테고리 필터링 (L645-665)
   - 페어링 실패 시 TRANSFER 유지 (L880-975, 3곳)

### 영향 받는 기능

✅ **긍정적 영향**:
- 통계 정확도 향상
- 이체 제외 필터 정상 작동
- 카테고리-타입 일관성 유지

⚠️ **주의 필요**:
- **기존 데이터**: 이미 잘못 저장된 레코드는 수동 수정 필요
  - 쿼리: `SELECT * FROM transactions WHERE type IN ('INCOME', 'EXPENSE') AND category_name LIKE '%이체%'`
  - 조치: 타입을 `TRANSFER`로 변경
- **단일 계좌 원장 모드**: 이제 수동으로 활성화해야 함
  - 사용자가 명시적으로 체크박스 선택 필요

---

## 🧪 테스트 시나리오

### 시나리오 1: 일반 이체 (페어링 성공)

```
입력:
  Row A: 타입=이체, 금액=100,000, 계좌=A, 시간=14:00
  Row B: 타입=이체, 금액=100,000, 계좌=B, 시간=14:00

기대 결과:
  1개 TRANSFER (account=A, counter=B, amount=-100000, auto_match=true)

통계 영향:
  이체 제외 → ✅ 올바르게 제외됨
```

### 시나리오 2: 단방향 이체 (페어링 실패)

```
입력:
  Row A: 타입=이체, 금액=100,000, 계좌=A, 시간=14:00
  (짝이 없음)

기존 로직:
  type="INCOME", category="이체" → ❌ 통계에 포함

새 로직:
  type="TRANSFER", category="계좌이체" → ✅ 통계에서 제외

통계 영향:
  이체 제외 → ✅ 올바르게 제외됨
```

### 시나리오 3: 단일 계좌 모드 OFF (기본값)

```
입력:
  다양한 계좌의 수입/지출/이체 혼합

기대 결과:
  - 각 거래의 타입 보존
  - 페어링 가능한 이체는 매칭
  - 페어링 실패해도 TRANSFER 유지

통계 영향:
  타입별 정확한 집계 ✅
```

### 시나리오 4: 단일 계좌 모드 ON (수동 활성화)

```
사용자 선택:
  ☑ 단일 계좌 원장 모드
  주 계좌명: "저축예금 84607"

입력:
  타입=이체, 카테고리=카드대금 (잔액중립 패턴)

기대 결과:
  type="TRANSFER", balance_neutral=true, counter 없음

통계 영향:
  이체 제외 → ✅ 제외됨
```

---

## 🔍 디버깅 가이드

### 문제: "이체 제외" 체크해도 통계에 포함됨

**1단계: 트랜잭션 타입 확인**

```sql
SELECT id, type, category_name, amount, account_name, occurred_at
FROM transactions
WHERE category_name LIKE '%이체%'
ORDER BY occurred_at DESC
LIMIT 20;
```

**예상 결과 (개선 전)**:
```
id | type    | category_name | amount
---|---------|---------------|--------
10 | INCOME  | 이체           | 100000  ❌
11 | EXPENSE | 계좌이체       | -50000  ❌
```

**예상 결과 (개선 후)**:
```
id | type     | category_name | amount
---|----------|---------------|--------
10 | TRANSFER | 계좌이체       | 100000  ✅
11 | TRANSFER | 내계좌이체     | -50000  ✅
```

**2단계: 타입 수정 (필요 시)**

```sql
-- 백업 먼저!
CREATE TABLE transactions_backup_20251020 AS SELECT * FROM transactions;

-- 이체 카테고리인데 타입이 INCOME/EXPENSE인 레코드 수정
UPDATE transactions
SET type = 'TRANSFER'
WHERE type IN ('INCOME', 'EXPENSE')
  AND (
    category_name LIKE '%이체%'
    OR category_group_name LIKE '%이체%'
  );
```

**3단계: 통계 API 테스트**

```bash
# 이체 제외 OFF
curl "http://localhost:8000/api/analytics/overview?user_id=1&include_transfers=true"

# 이체 제외 ON
curl "http://localhost:8000/api/analytics/overview?user_id=1&include_transfers=false"

# 차이 확인
```

---

## 📌 향후 개선 방향

### 1. 기존 데이터 마이그레이션 스크립트

```python
# apps/backend/scripts/fix_transfer_types.py
def fix_mismatched_transfers(db: Session):
    """
    타입은 INCOME/EXPENSE인데 카테고리가 '이체'인 레코드를 TRANSFER로 수정
    """
    mismatched = db.query(Transaction).filter(
        Transaction.type.in_([TxnType.INCOME, TxnType.EXPENSE]),
        or_(
            Transaction.category_name.like('%이체%'),
            Transaction.category_group_name.like('%이체%'),
        )
    ).all()
    
    for txn in mismatched:
        txn.type = TxnType.TRANSFER
        # 잔액 재계산 필요 시 추가 로직
    
    db.commit()
    print(f"Fixed {len(mismatched)} transactions")
```

### 2. UI 경고 추가

**업로드 미리보기에서**:
```tsx
{parseResult.items.some(item => 
  item.type !== "TRANSFER" && 
  item.category_name?.includes("이체")
) && (
  <div className="rounded border-amber-300 bg-amber-50 p-3 text-sm">
    ⚠️ 경고: 일부 거래가 "이체" 카테고리이지만 타입이 수입/지출입니다.
    단일 계좌 모드를 비활성화하거나 파일을 확인하세요.
  </div>
)}
```

### 3. 백엔드 validation 강화

```python
# apps/backend/app/routers.py - create_transaction
def validate_transfer_consistency(item: TransactionCreate):
    """이체 타입-카테고리 일관성 검증"""
    transfer_keywords = ["이체", "계좌이체", "내계좌", "transfer"]
    
    if item.type == TxnType.TRANSFER:
        # TRANSFER는 OK
        return
    
    if item.category_name and any(kw in item.category_name.lower() for kw in transfer_keywords):
        raise HTTPException(
            status_code=400,
            detail=f"카테고리가 '이체'인데 타입이 {item.type}입니다. 일관성 오류."
        )
```

### 4. 통계 계산 로직 개선

현재는 `type == TRANSFER`만 체크하지만, 카테고리 기반 제외도 추가:

```python
def _should_skip(txn, include_transfers_flag, excluded_categories):
    # 기존 로직
    if not include_transfers_flag:
        if txn.type == TxnType.TRANSFER:
            return True
        # 추가: 카테고리로도 이체 판별
        if txn.category and any(kw in txn.category.name.lower() for kw in ["이체", "transfer"]):
            return True
    return False
```

---

## 📝 요약

### 문제
- ❌ 엑셀 "이체" → 저장 시 "수입/지출" + 카테고리 "이체" → 통계 오염

### 해결
- ✅ 단일 계좌 모드 기본값 OFF
- ✅ 자동 활성화 제거
- ✅ 강등 시 "이체" 카테고리 제외
- ✅ **페어링 실패해도 TRANSFER 타입 유지**

### 핵심 원칙
```
엑셀에 "이체"라고 써있으면 무조건 TRANSFER로 저장
→ 통계에서 이체 제외 필터가 제대로 작동
```

### 적용 방법
1. 코드 변경사항 머지
2. 기존 데이터 수정 (선택):
   ```sql
   UPDATE transactions SET type='TRANSFER'
   WHERE type IN ('INCOME','EXPENSE') AND category_name LIKE '%이체%';
   ```
3. 사용자 안내: 단일 계좌 모드는 이제 수동 활성화

### 검증
- 새 파일 업로드 → 타입 확인 (`type` 컬럼)
- 통계 페이지 → 이체 제외 체크 → 금액 변화 확인
- 카테고리 목록 → "이체" 카테고리의 트랜잭션 타입 확인
