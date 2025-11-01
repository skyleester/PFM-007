# 내부 이체 vs 외부 이체 구분 개선 (2025-10-20)

## 🎯 목표

엑셀의 "이체" 타입 트랜잭션을 두 가지로 구분:
1. **내부 이체** (A계좌 → B계좌): TRANSFER 타입 유지, 전체 잔액 변동 없음
2. **외부 이체** (급여 입금, 외부 송금 등): **INCOME/EXPENSE로 자동 변환**, 통계에 반영

---

## 🔴 기존 문제

### 문제 1: 외부 이체가 TRANSFER로 고정
```
급여 입금:
  엑셀: 타입=이체, 금액=3,000,000
  저장: type="TRANSFER", counter_account="A계좌 (상대)"  ❌
  결과: 통계에 반영 안 됨, 수동 변경 불가
```

### 문제 2: A→A 이체 발생
```
페어링 실패 시:
  A계좌 입금 → counter_account 없음 → 기본값 생성 → A→A
  결과: 동일 계좌 간 이체, 잔액 상쇄
```

### 문제 3: 타입 변경 불가
- UI에서 `lockType=true` → 편집 시 타입 선택 비활성화
- 백엔드 `TransactionUpdate`에 `type` 필드 없음

---

## ✅ 적용한 해결책

### 1. 파싱: 외부 이체 자동 감지

**파일**: `apps/web/lib/importers/banksalad.ts`

#### 1-1. 짝이 없는 TRANSFER → INCOME/EXPENSE

```typescript
// 변경 전 (L882-900)
else {
  // 짝이 전혀 없는 단독 항목들도 TRANSFER 타입 유지
  for (const single of arr) {
    items.push({
      type: "TRANSFER",  // ❌
      // ...
    });
  }
}

// 변경 후
else {
  // 짝이 없는 단독 항목 → 외부 이체로 간주하여 INCOME/EXPENSE로 변환
  for (const single of arr) {
    const externalType: TxnType = single.amount < 0 ? "EXPENSE" : "INCOME";
    const fallbackGroup = single.groupText || DEFAULT_GROUP[externalType];
    const fallbackCategory = single.categoryText || DEFAULT_CATEGORY[externalType];
    
    items.push({
      type: externalType,  // ✅ 외부 이체 → INCOME/EXPENSE
      amount: single.amount,
      category_group_name: fallbackGroup,
      category_name: fallbackCategory,
      // ...
    });
  }
}
```

**효과**:
- 급여 입금 → `type="INCOME"`, 통계에 반영 ✅
- 외부 송금 → `type="EXPENSE"`, 통계에 반영 ✅

#### 1-2. 동일 계좌 이체 → INCOME/EXPENSE

```typescript
// 변경 전 (L911-930)
if (normalizeAccountKey(o.account_name) === normalizeAccountKey(inn.account_name)) {
  // 동일 계좌면 TRANSFER 유지
  for (const single of [o, inn]) {
    items.push({ type: "TRANSFER", ... });  // ❌
  }
}

// 변경 후
if (normalizeAccountKey(o.account_name) === normalizeAccountKey(inn.account_name)) {
  // 동일 계좌면 외부 이체로 간주
  for (const single of [o, inn]) {
    const externalType: TxnType = single.amount < 0 ? "EXPENSE" : "INCOME";
    items.push({ type: externalType, ... });  // ✅
  }
}
```

#### 1-3. 페어링 후 남은 항목 → INCOME/EXPENSE

```typescript
// 변경 전 (L955-975)
// 남은 unmatched → TRANSFER 유지
for (const single of leftovers) {
  items.push({ type: "TRANSFER", ... });  // ❌
}

// 변경 후
// 남은 unmatched → 외부 이체로 INCOME/EXPENSE 변환
for (const single of leftovers) {
  const externalType: TxnType = single.amount < 0 ? "EXPENSE" : "INCOME";
  items.push({ type: externalType, ... });  // ✅
}
```

---

### 2. UI: 타입 변경 허용

**파일**: `apps/web/app/transactions/page.tsx`

#### 2-1. lockType 해제

```typescript
// 변경 전 (L1537)
<TxnForm
  draft={draft}
  setDraft={setDraft}
  // ...
  lockType  // ❌ 타입 변경 불가
/>

// 변경 후
<TxnForm
  draft={draft}
  setDraft={setDraft}
  // ...
  lockType={false}  // ✅ 타입 변경 가능
/>
```

#### 2-2. 타입 필드 전송

```typescript
// 변경 전 (L1570-1584)
const body: any = {
  occurred_at: draft.occurred_at,
  // ... type 없음! ❌
};
if (draft.type === "TRANSFER") {
  body.counter_account_id = draft.counter_account_id;
} else {
  body.category_id = draft.category_id;
}

// 변경 후
const body: any = {
  occurred_at: draft.occurred_at,
  type: draft.type,  // ✅ 타입 포함
  // ...
};
if (draft.type === "TRANSFER") {
  body.counter_account_id = draft.counter_account_id;
  body.category_id = null;  // TRANSFER로 변경 시 카테고리 제거
} else {
  body.category_id = draft.category_id;
  body.counter_account_id = null;  // INCOME/EXPENSE로 변경 시 상대 계좌 제거
}
```

---

### 3. 백엔드: 타입 변경 지원

#### 3-1. 스키마 업데이트

**파일**: `apps/backend/app/schemas.py`

```python
# 변경 전
class TransactionUpdate(BaseModel):
    occurred_at: Optional[date] = None
    # ... type 없음! ❌

# 변경 후
class TransactionUpdate(BaseModel):
    occurred_at: Optional[date] = None
    type: Optional[TxnType] = None  # ✅ 타입 변경 지원
    account_id: Optional[int] = None
    counter_account_id: Optional[int] = None
    category_id: Optional[int] = None
    # ...
```

#### 3-2. PATCH 로직 개선

**파일**: `apps/backend/app/routers.py` (L2371-2410)

```python
# 타입 변경 처리 로직 추가
old_type = tx.type
new_type = changes.get("type", old_type)

if new_type != old_type:
    # TRANSFER → INCOME/EXPENSE
    if old_type == TxnType.TRANSFER and new_type in (TxnType.INCOME, TxnType.EXPENSE):
        changes["counter_account_id"] = None  # 상대 계좌 제거
        if "category_id" not in changes or changes["category_id"] is None:
            raise HTTPException(
                status_code=400,
                detail="category_id required when converting TRANSFER to INCOME/EXPENSE"
            )
    
    # INCOME/EXPENSE → TRANSFER
    elif old_type in (TxnType.INCOME, TxnType.EXPENSE) and new_type == TxnType.TRANSFER:
        changes["category_id"] = None  # 카테고리 제거
        if "counter_account_id" not in changes or changes["counter_account_id"] is None:
            raise HTTPException(
                status_code=400,
                detail="counter_account_id required when converting to TRANSFER"
            )
```

**효과**:
- TRANSFER → INCOME: 카테고리 필수, counter_account 제거
- INCOME → TRANSFER: counter_account 필수, 카테고리 제거
- 잔액 계산 자동 조정

---

## 📊 동작 시나리오

### 시나리오 1: 급여 입금 (외부 이체)

```
엑셀 입력:
  날짜: 2024-01-25
  타입: 이체
  금액: 3,000,000
  계좌: 급여통장
  
파싱 결과 (자동):
  type: "INCOME"  ✅
  amount: 3000000
  account_name: "급여통장"
  category_group_name: "기타 수입"
  category_name: "미분류 수입"
  
통계:
  수입: +3,000,000원 ✅
  지출: 0원
  순수익: +3,000,000원
```

### 시나리오 2: 내부 이체 (A → B)

```
엑셀 입력:
  Row A: 타입=이체, 금액=-500,000, 계좌=저축통장, 시간=14:00
  Row B: 타입=이체, 금액=+500,000, 계좌=입출금통장, 시간=14:00
  
파싱 결과 (페어링 성공):
  type: "TRANSFER"  ✅
  amount: -500000
  account_name: "저축통장"
  counter_account_name: "입출금통장"
  
통계:
  수입: 0원 (이체 제외)
  지출: 0원 (이체 제외)
  
잔액:
  저축통장: -500,000원
  입출금통장: +500,000원
```

### 시나리오 3: 수동 타입 변경

```
기존 트랜잭션:
  type: "TRANSFER"
  amount: -50000
  counter_account: "A계좌 (상대)"
  
사용자 편집:
  유형 선택: EXPENSE
  카테고리 선택: "식비 > 외식"
  저장
  
저장 결과:
  type: "EXPENSE"  ✅
  amount: -50000
  counter_account_id: null
  category_id: 123
  
통계:
  지출: +50,000원 ✅
```

---

## 🔍 내부 vs 외부 이체 판별 기준

| 조건 | 결과 | 타입 |
|------|------|------|
| 페어링 성공 (A계좌 ↔ B계좌) | 내부 이체 | TRANSFER |
| 페어링 실패 (짝 없음) | 외부 이체 | INCOME/EXPENSE |
| 동일 계좌 (A ↔ A) | 외부 이체 | INCOME/EXPENSE |
| 명시적 counter_account 있음 | 내부 이체 | TRANSFER |
| counter_account 없음 | 외부 이체 | INCOME/EXPENSE |

---

## 📝 변경된 파일 요약

### 프론트엔드

1. **`apps/web/lib/importers/banksalad.ts`**
   - L882-900: 짝 없는 TRANSFER → INCOME/EXPENSE
   - L911-930: 동일 계좌 이체 → INCOME/EXPENSE
   - L955-975: 남은 unmatched → INCOME/EXPENSE

2. **`apps/web/app/transactions/page.tsx`**
   - L1537: `lockType={false}` 설정
   - L1573: `type: draft.type` 추가
   - L1586-1589: 타입별 필드 null 처리

### 백엔드

1. **`apps/backend/app/schemas.py`**
   - L309: `type: Optional[TxnType] = None` 추가

2. **`apps/backend/app/routers.py`**
   - L2371-2390: 타입 변경 처리 로직 추가
   - L2391-2405: 카테고리 검증 로직 수정

---

## 🧪 테스트 체크리스트

### 파싱 테스트

- [ ] 급여 입금 (외부 이체) → INCOME으로 변환 확인
- [ ] 외부 송금 (외부 이체) → EXPENSE로 변환 확인
- [ ] A→B 이체 (페어링 성공) → TRANSFER 유지 확인
- [ ] A→A 이체 (동일 계좌) → INCOME/EXPENSE 변환 확인

### UI 테스트

- [ ] 트랜잭션 편집 모달에서 유형 드롭다운 활성화 확인
- [ ] TRANSFER → INCOME 변경 시 카테고리 선택 필수 확인
- [ ] INCOME → TRANSFER 변경 시 상대 계좌 선택 필수 확인
- [ ] 타입 변경 후 저장 → 통계 반영 확인

### 백엔드 테스트

- [ ] PATCH with `type` → 200 OK
- [ ] TRANSFER → INCOME without `category_id` → 400 Bad Request
- [ ] INCOME → TRANSFER without `counter_account_id` → 400 Bad Request
- [ ] 타입 변경 후 잔액 재계산 확인

---

## 🎯 기대 효과

### Before (문제 발생)

```
급여 3,000,000원 입금
  ↓
type: "TRANSFER"
counter_account: "급여통장 (상대)"
  ↓
통계: 반영 안 됨 😱
사용자: 타입 변경 불가 😱
```

### After (해결!)

```
급여 3,000,000원 입금
  ↓
type: "INCOME" (자동 변환)
category: "기타 수입 > 미분류 수입"
  ↓
통계: 수입 +3,000,000원 ✅
사용자: 필요 시 카테고리만 수정 ✅
```

---

## 🚨 주의사항

### 1. 기존 데이터

외부 이체로 잘못 저장된 기존 TRANSFER 레코드는 수동 변경 필요:

```sql
-- 외부 이체로 의심되는 레코드 조회
SELECT id, occurred_at, amount, account_id, counter_account_id, memo
FROM transactions
WHERE type = 'TRANSFER'
  AND (
    counter_account_id IS NULL
    OR account_id = counter_account_id
  );

-- 수동으로 타입 변경 (급여 등 수입)
-- UI에서 편집 → 유형: INCOME → 카테고리 선택 → 저장
```

### 2. 페어링 우선순위

명시적 `counter_account` 정보가 있으면 내부 이체로 우선 판단:
- 엑셀에 "출금계좌", "입금계좌" 컬럼이 제대로 채워져 있으면 페어링 우선
- 없으면 날짜+시간+금액으로 휴리스틱 페어링 시도
- 그래도 실패하면 외부 이체로 간주

### 3. 단일 계좌 모드

단일 계좌 모드 활성화 시:
- 잔액중립 패턴 (카드대금 등) → TRANSFER 유지
- 그 외 → INCOME/EXPENSE로 강등 (기존 동작)

---

## 📌 향후 개선 방향

### 1. 외부 이체 패턴 학습

```python
# 사용자가 자주 변환하는 패턴 학습
pattern_rules = [
    {"memo": "급여", "default_type": "INCOME", "category": "급여 수입"},
    {"memo": "배당", "default_type": "INCOME", "category": "금융 수입"},
    {"memo": "카드대금", "default_type": "TRANSFER", "neutral": True},
]
```

### 2. UI 개선

```tsx
// 파싱 미리보기에서 외부 이체 감지 경고
{parseResult.items.filter(item => 
  item.type !== "TRANSFER" && 
  item.transfer_flow  // 원래 TRANSFER였음
).length > 0 && (
  <div className="alert-info">
    ℹ️ {count}건의 외부 이체를 수입/지출로 자동 변환했습니다.
    확인 후 필요 시 카테고리를 수정하세요.
  </div>
)}
```

### 3. 벌크 타입 변경

```tsx
// 선택된 여러 거래의 타입을 한 번에 변경
<button onClick={() => bulkUpdateType(selectedIds, "INCOME")}>
  선택 항목을 수입으로 변경
</button>
```

---

## 📖 관련 문서

- [transfer-type-fix.md](./transfer-type-fix.md): 이체 타입 보존 개선
- [bulk-upload-process.md](./bulk-upload-process.md): Bulk upload 전체 프로세스 분석

---

## ✅ 요약

### 문제
- ❌ 외부 이체(급여 등)가 TRANSFER로 고정 → 통계 반영 안 됨
- ❌ A→A 이체 발생
- ❌ 타입 수동 변경 불가

### 해결
- ✅ 페어링 실패 → 자동으로 INCOME/EXPENSE 변환
- ✅ 동일 계좌 이체 → INCOME/EXPENSE 변환
- ✅ UI에서 타입 변경 허용 + 백엔드 지원

### 핵심
```
내부 이체 (A ↔ B) → TRANSFER (잔액만 이동)
외부 이체 (급여, 송금) → INCOME/EXPENSE (통계 반영)
```
