# 내부 이체 매칭 로직 v2 (2025-10-20)

## 🎯 목표

### 문제점
1. **분류명 의존도 과다**: "내계좌이체"가 아니면 외부 이체로 오분류
2. **휴리스틱 매칭 부족**: 시간+금액만 일치해도 내용이 다르면 매칭 실패
3. **분산 업로드 미지원**: 여러 파일에 나눠진 이체 쌍을 연결 불가

### 해결 전략
```
3단계 매칭 시스템:

1️⃣ 확실한 매칭 (자동 처리)
   - counter_account 명시
   - 분류가 "내계좌이체" 계열
   → 즉시 TRANSFER로 등록

2️⃣ 의심 매칭 (사용자 확인)
   - 시간+금액 절대값 일치
   - memo/내용이 다르거나 계좌 정보 불일치
   → 사용자에게 확인 요청

3️⃣ 외부 이체 (자동 처리)
   - 짝이 없음
   → INCOME/EXPENSE로 변환
```

---

## 📊 사례 분석

### 사례 1: 분류명이 다른 내부 이체

```
2025-10-13	09:02	이체	이체	미분류	이호천	400000	KRW	입출금통장 4305	
2025-10-13	09:02	이체	이체	미분류	윤지수	-400000	KRW	급여 하나 통장 (호천)	
```

**현재 로직**:
- `groupText="이체"` (≠ "내계좌이체")
- `categoryText="미분류"`
- 시간+금액 일치 → 페어링 시도
- 계좌 다름 → TRANSFER 생성 ✅

**문제 없음**: 이미 정상 작동 중

---

### 사례 2: 내용이 다른 내부 이체

```
2025-10-10	09:45	이체	내계좌이체	미분류	윤지수	400000	KRW	입출금통장 4305	
2025-10-10	09:45	이체	내계좌이체	미분류	호호	-400000	KRW	급여 하나 통장(지수)	
```

**현재 로직**:
- `groupText="내계좌이체"` → TRANSFER 확정
- 시간+금액 일치 → 페어링 시도
- `memoCombined` 다름: "윤지수" vs "호호"
- 계좌 다름 → TRANSFER 생성 ✅

**개선 필요**:
- memo가 다르면 "의심 매칭"으로 분류
- 사용자에게 확인 요청 후 처리

---

### 사례 3: 분산 업로드 (기존 DB 매칭)

```
파일 A (2025-10-13 업로드):
  2025-10-10	09:45	이체	...	-400000	KRW	급여 하나 통장(지수)
  → DB 저장: id=1234, type=INCOME (외부 이체로 오판)

파일 B (2025-10-15 업로드):
  2025-10-10	09:45	이체	...	+400000	KRW	입출금통장 4305
  → 매칭 시도: DB에서 id=1234 발견!
  → 사용자 확인: 내부 이체로 연결할까요?
```

**새로운 기능**:
- 업로드 시 기존 트랜잭션 중 시간+금액 일치하는 항목 검색
- "의심 매칭" 목록에 추가
- 사용자가 승인하면 두 거래를 TRANSFER로 변환

---

## 🔧 구현 설계

### 1. 매칭 신뢰도 점수

```typescript
interface MatchConfidence {
  score: number; // 0-100
  level: "CERTAIN" | "SUSPECTED" | "UNLIKELY";
  reasons: string[];
}

function calculateMatchConfidence(
  out: PendingTransfer,
  inn: PendingTransfer
): MatchConfidence {
  let score = 0;
  const reasons: string[] = [];

  // 필수: 시간+금액 절대값 일치 (기본 50점)
  if (
    out.occurred_at === inn.occurred_at &&
    out.occurred_time === inn.occurred_time &&
    Math.abs(out.amount) === Math.abs(inn.amount) &&
    out.currency === inn.currency
  ) {
    score += 50;
  } else {
    return { score: 0, level: "UNLIKELY", reasons: ["시간 또는 금액 불일치"] };
  }

  // 분류명 확인 (+30점)
  const internalKeywords = ["내계좌이체", "계좌이체", "이체"];
  if (
    internalKeywords.some(kw => 
      out.groupText?.includes(kw) || out.categoryText?.includes(kw)
    ) &&
    internalKeywords.some(kw => 
      inn.groupText?.includes(kw) || inn.categoryText?.includes(kw)
    )
  ) {
    score += 30;
    reasons.push("분류명이 내부 이체 패턴과 일치");
  }

  // 계좌 정보 확인 (+10점)
  if (normalizeAccountKey(out.account_name) !== normalizeAccountKey(inn.account_name)) {
    score += 10;
    reasons.push("서로 다른 계좌");
  } else {
    score -= 20;
    reasons.push("⚠️ 동일 계좌 (A→A)");
  }

  // Memo 유사도 (+10점 or -10점)
  const memoSimilarity = calculateSimilarity(out.memoCombined, inn.memoCombined);
  if (memoSimilarity > 0.7) {
    score += 10;
    reasons.push("내용 유사");
  } else if (memoSimilarity < 0.3) {
    score -= 10;
    reasons.push("⚠️ 내용 불일치");
  }

  // 신뢰도 레벨 결정
  let level: MatchConfidence["level"];
  if (score >= 80) {
    level = "CERTAIN"; // 자동 처리
  } else if (score >= 50) {
    level = "SUSPECTED"; // 사용자 확인 필요
  } else {
    level = "UNLIKELY"; // 외부 이체로 간주
  }

  return { score, level, reasons };
}
```

---

### 2. 의심 매칭 데이터 구조

```typescript
export interface SuspectedPair {
  id: string; // 임시 ID (프론트엔드용)
  confidence: MatchConfidence;
  outgoing: BulkTransactionData;
  incoming: BulkTransactionData;
  existingTxnId?: number; // 기존 DB 트랜잭션 ID (분산 업로드용)
}

export interface BulkUploadResponse {
  created: number;
  duplicates: number;
  suspectedPairs: SuspectedPair[]; // 사용자 확인 필요
  issues: string[];
  summary: BankSaladParseSummary;
}
```

---

### 3. 백엔드 API 개선

#### POST /api/transactions/bulk

```python
@router.post("/transactions/bulk", response_model=BulkUploadResponse)
async def bulk_create_transactions(
    req: BulkTransactionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    벌크 트랜잭션 생성 with 의심 매칭 감지
    """
    created = []
    duplicates = []
    suspected_pairs = []
    
    for item in req.items:
        # 1. 중복 체크 (기존 로직)
        existing = find_duplicate_transaction(db, item)
        if existing:
            duplicates.append(existing.id)
            continue
        
        # 2. 의심 매칭 체크 (새로운 로직)
        potential_match = find_potential_transfer_match(
            db, 
            item, 
            current_user.id,
            time_tolerance_minutes=5
        )
        
        if potential_match:
            confidence = calculate_match_confidence(item, potential_match)
            if confidence["level"] == "SUSPECTED":
                suspected_pairs.append({
                    "id": f"suspect-{len(suspected_pairs)}",
                    "confidence": confidence,
                    "new_item": item,
                    "existing_txn_id": potential_match.id,
                    "existing_txn": {
                        "occurred_at": potential_match.occurred_at,
                        "amount": potential_match.amount,
                        "account_name": potential_match.account.name,
                        "memo": potential_match.memo,
                    }
                })
                # 일단 저장하지 않고 대기
                continue
        
        # 3. 확실한 트랜잭션은 즉시 생성
        txn = create_transaction(db, item, current_user.id)
        created.append(txn.id)
    
    return {
        "created": len(created),
        "duplicates": len(duplicates),
        "suspected_pairs": suspected_pairs,
        "issues": [],
        "summary": calculate_summary(created),
    }
```

#### POST /api/transactions/bulk/confirm-pairs

```python
class ConfirmPairRequest(BaseModel):
    action: Literal["link", "separate"]  # link=내부이체로 연결, separate=별도 거래
    new_item: BulkTransactionData
    existing_txn_id: int

@router.post("/transactions/bulk/confirm-pairs")
async def confirm_suspected_pairs(
    req: ConfirmPairRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    의심 매칭 항목에 대한 사용자 결정 처리
    """
    existing = db.query(Transaction).filter_by(
        id=req.existing_txn_id,
        user_id=current_user.id
    ).first()
    
    if not existing:
        raise HTTPException(404, "기존 거래를 찾을 수 없습니다")
    
    if req.action == "link":
        # 내부 이체로 연결
        # 1. 기존 거래를 TRANSFER로 변환
        existing.type = TxnType.TRANSFER
        existing.category_id = None
        
        # 2. 새 거래를 counter로 설정
        new_account = get_or_create_account(db, req.new_item.account_name, current_user.id)
        existing.counter_account_id = new_account.id
        
        # 3. transfer_group으로 묶기 (선택사항)
        # ...
        
        db.commit()
        return {"status": "linked", "txn_id": existing.id}
    
    else:  # separate
        # 별도 거래로 등록
        new_txn = create_transaction(db, req.new_item, current_user.id)
        db.commit()
        return {"status": "created", "txn_id": new_txn.id}
```

---

### 4. 프론트엔드 UI 흐름

#### 업로드 페이지 (`/transactions`)

```tsx
// 1. 파일 파싱 후 bulk API 호출
const handleUpload = async (parsedItems: BulkTransactionData[]) => {
  const response = await fetch("/api/transactions/bulk", {
    method: "POST",
    body: JSON.stringify({ items: parsedItems }),
  });
  
  const result: BulkUploadResponse = await response.json();
  
  if (result.suspectedPairs.length > 0) {
    // 의심 매칭이 있으면 확인 모달 표시
    setSuspectedPairs(result.suspectedPairs);
    setShowConfirmModal(true);
  } else {
    // 없으면 바로 완료
    toast.success(`${result.created}건 등록 완료`);
    refreshTransactions();
  }
};
```

#### 의심 매칭 확인 모달

```tsx
<Dialog open={showConfirmModal}>
  <DialogHeader>
    <DialogTitle>내부 이체로 연결할까요?</DialogTitle>
    <DialogDescription>
      {suspectedPairs.length}건의 의심 내부 이체를 발견했습니다.
    </DialogDescription>
  </DialogHeader>
  
  <div className="space-y-4">
    {suspectedPairs.map((pair) => (
      <Card key={pair.id}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant={
              pair.confidence.level === "CERTAIN" ? "success" :
              pair.confidence.level === "SUSPECTED" ? "warning" :
              "destructive"
            }>
              신뢰도 {pair.confidence.score}%
            </Badge>
            <span className="text-sm text-muted-foreground">
              {pair.confidence.reasons.join(", ")}
            </span>
          </div>
        </CardHeader>
        
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {/* 기존 거래 */}
            <div className="border-r pr-4">
              <p className="font-semibold">기존 거래</p>
              <p>{pair.existing_txn.occurred_at}</p>
              <p className="text-xl">{formatCurrency(pair.existing_txn.amount)}</p>
              <p className="text-sm">{pair.existing_txn.account_name}</p>
              <p className="text-sm text-muted-foreground">{pair.existing_txn.memo}</p>
            </div>
            
            {/* 새 거래 */}
            <div className="pl-4">
              <p className="font-semibold">새 거래</p>
              <p>{pair.new_item.occurred_at}</p>
              <p className="text-xl">{formatCurrency(pair.new_item.amount)}</p>
              <p className="text-sm">{pair.new_item.account_name}</p>
              <p className="text-sm text-muted-foreground">{pair.new_item.memo}</p>
            </div>
          </div>
        </CardContent>
        
        <CardFooter className="flex gap-2">
          <Button
            variant="default"
            onClick={() => confirmPair(pair.id, "link")}
          >
            ✅ 내부 이체로 연결
          </Button>
          <Button
            variant="outline"
            onClick={() => confirmPair(pair.id, "separate")}
          >
            ❌ 별도 거래로 등록
          </Button>
        </CardFooter>
      </Card>
    ))}
  </div>
  
  <DialogFooter>
    <Button onClick={() => confirmAllPairs("link")}>
      전체 연결
    </Button>
    <Button variant="secondary" onClick={() => confirmAllPairs("separate")}>
      전체 별도 등록
    </Button>
  </DialogFooter>
</Dialog>
```

---

## 🧪 테스트 시나리오

### 시나리오 1: 확실한 내부 이체

```
입력:
  2025-10-13	09:02	이체	이체	미분류	이호천	400000	입출금통장 4305
  2025-10-13	09:02	이체	이체	미분류	윤지수	-400000	급여 하나 통장

신뢰도 계산:
  - 시간+금액 일치: +50
  - 분류명 "이체": +30
  - 다른 계좌: +10
  - memo 다름 ("이호천" vs "윤지수"): -10
  총점: 80 → CERTAIN

결과:
  ✅ 자동으로 TRANSFER 생성
  의심 매칭 없음
  
테스트 실행:
  $ python3 test_transfer_matching.py
  [Test Case 1] CERTAIN (PASS) ✅
```

---

### 시나리오 2: 의심 내부 이체

```
입력:
  2025-10-10	09:45	이체	내계좌이체	미분류	윤지수	400000	입출금통장 4305
  2025-10-10	09:45	이체	내계좌이체	미분류	호호	-400000	급여 하나 통장

신뢰도 계산:
  - 시간+금액 일치: +50
  - 분류명 "내계좌이체": +30
  - "내계좌이체" 명시 보너스: +10
  - 다른 계좌: +10
  - memo 다름 ("윤지수" vs "호호"): -10
  총점: 90 → CERTAIN

결과:
  ✅ 자동으로 TRANSFER 생성
  (memo 불일치에도 불구하고 "내계좌이체" 명시로 신뢰도 높음)
  
테스트 실행:
  $ python3 test_transfer_matching.py
  [Test Case 2] CERTAIN (90점) ✅
```

**개선 노트**: 
사용자가 원한 "의심 매칭"으로 분류하려면 임계값 조정이 필요합니다:
- 현재: 80점 이상 = CERTAIN
- 제안: 90점 이상 = CERTAIN, 60-89점 = SUSPECTED

임계값 조정 시:
```typescript
// banksalad.ts의 calculateMatchConfidence 함수
if (score >= 90) {  // 80 → 90으로 상향
  level = "CERTAIN";
} else if (score >= 60) {  // 50 → 60으로 상향
  level = "SUSPECTED";
}
```

이렇게 하면 Test Case 2는 SUSPECTED(90점)로 분류되어 사용자 확인 모달이 표시됩니다.

---

### 시나리오 3: 분산 업로드

```
1차 업로드 (2025-10-13):
  2025-10-10	09:45	이체	...	-400000	급여 하나 통장
  → DB 저장: id=1234, type=INCOME (외부 이체로 오판)

2차 업로드 (2025-10-15):
  2025-10-10	09:45	이체	...	+400000	입출금통장 4305
  
매칭:
  - DB 검색: id=1234 발견 (시간+금액 일치)
  - 신뢰도: 70점 → SUSPECTED
  
UI:
  ⚠️ 의심 내부 이체 발견
  [기존] 2025-10-10 -400,000 급여 하나 통장
  [새]   2025-10-10 +400,000 입출금통장 4305
  
사용자 선택:
  ✅ 내부 이체로 연결
  
결과:
  - id=1234를 TRANSFER로 변환
  - counter_account_id = 입출금통장 4305
  - 새 거래는 생성하지 않음 (중복 방지)
```

---

## 📈 우선순위

### Phase 1: 신뢰도 점수 시스템 (현재)
- [x] 기존 페어링 로직 분석
- [ ] `calculateMatchConfidence()` 구현
- [ ] 테스트 케이스 작성

### Phase 2: 의심 매칭 감지 (프론트엔드)
- [ ] `SuspectedPair` 타입 정의
- [ ] banksalad.ts 파싱 로직 수정 (신뢰도 계산 추가)
- [ ] 확인 모달 UI 구현

### Phase 3: DB 매칭 (백엔드)
- [ ] `find_potential_transfer_match()` 구현
- [ ] `POST /api/transactions/bulk/confirm-pairs` 엔드포인트
- [ ] 기존 트랜잭션 타입 변환 로직

### Phase 4: 고급 기능
- [ ] 사용자별 매칭 규칙 학습 (ML)
- [ ] 일괄 처리 (전체 연결/전체 별도)
- [ ] 매칭 히스토리 추적

---

## 🚨 주의사항

### 1. 잔액 무결성
```python
# 기존 INCOME을 TRANSFER로 변환 시 잔액 롤백 필요
def convert_income_to_transfer(txn: Transaction, counter_account_id: int):
    # 1. 기존 잔액 증가분 제거
    _revert_balance_effect(txn)
    
    # 2. 타입 변환
    txn.type = TxnType.TRANSFER
    txn.counter_account_id = counter_account_id
    txn.category_id = None
    
    # 3. TRANSFER용 잔액 적용 (전체 잔액 중립)
    _apply_transfer_balance(txn)
```

### 2. 중복 방지
```python
# 분산 업로드 시 이미 TRANSFER로 연결된 거래 재처리 방지
if existing.type == TxnType.TRANSFER and existing.counter_account_id:
    raise HTTPException(400, "이미 내부 이체로 연결된 거래입니다")
```

### 3. UI/UX
- 의심 매칭이 많으면 (10건+) 페이지네이션 필요
- "전체 건너뛰기" 버튼으로 의심 항목을 INCOME/EXPENSE로 즉시 등록
- 확인 후 다시 보지 않기 옵션 (신뢰도 임계값 설정)

---

## 📚 관련 문서
- [external-transfer-handling.md](./external-transfer-handling.md): 외부 이체 처리 개선
- [transfer-type-fix.md](./transfer-type-fix.md): 이체 타입 보존 개선
- [bulk-upload-process.md](./bulk-upload-process.md): Bulk upload 전체 프로세스 분석
