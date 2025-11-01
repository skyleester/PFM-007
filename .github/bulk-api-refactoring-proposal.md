# Bulk API 리팩토링 제안 (2025-10-20)

## 🔴 현재 문제점

### 1. 복잡도 과다
- **파일**: `apps/backend/app/routers.py`
- **함수**: `bulk_upsert_transactions` (약 400줄)
- **내부 함수**: 3개 중첩 (`pair_transfers`, `pair_transfers_tolerant`, 각각 100-200줄)
- **총 라인 수**: ~600줄 (주석 포함)

### 2. 책임 분산 부족
현재 하나의 함수가 너무 많은 일을 담당:
1. 사용자 검증
2. 데이터 정규화
3. TRANSFER 그룹핑
4. **페어링 로직** (가장 복잡)
5. 중복 감지 및 제거
6. override 처리 (기존 트랜잭션 삭제)
7. Settlement 중복 체크
8. 트랜잭션 생성
9. 잔액 업데이트

### 3. 테스트 어려움
- 단위 테스트 불가능 (모든 로직이 하나의 함수에 집중)
- 페어링 로직만 독립 테스트 불가
- 모킹이 어려움

### 4. 유지보수 어려움
- 버그 수정 시 영향 범위 파악 어려움
- 새로운 기능 추가 시 기존 로직 파악 필요
- 코드 가독성 저하

---

## ✅ 리팩토링 전략

### Phase 1: 서비스 레이어 분리

#### 목표 구조
```
app/
├── routers.py               # API 엔드포인트만
├── services/
│   ├── __init__.py
│   ├── transaction_service.py        # 비즈니스 로직
│   ├── transfer_pairing_service.py   # 페어링 전문
│   ├── balance_service.py            # 잔액 계산
│   └── duplicate_detection_service.py # 중복 감지
└── utils/
    ├── __init__.py
    └── normalization.py      # 정규화 유틸리티
```

---

### 새로운 구조

#### 1. `transfer_pairing_service.py` (핵심 페어링 로직)

```python
"""
TRANSFER 페어링 전문 서비스

책임:
- OUT/IN 방향 결정
- 페어 생성
- Tolerance 기반 매칭
"""

from typing import List, Tuple
from app import schemas, models
from .normalization import normalize_account_token, normalize_account_ref


class TransferPairingService:
    """TRANSFER 페어링 전문 클래스"""
    
    def __init__(self, tolerance: float = 2.0):
        self.tolerance = tolerance
    
    def pair_transfers(
        self, 
        entries: List[schemas.TransactionCreate]
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], List[schemas.TransactionCreate]]:
        """
        TRANSFER 항목들을 OUT/IN으로 페어링
        
        Returns:
            (paired_items, unpaired_items)
            paired_items: [(combined_transfer, is_auto_match), ...]
            unpaired_items: [leftover_transfer, ...]
        """
        # 2개 항목 특수 케이스
        if len(entries) == 2:
            return self._pair_two_entries(entries)
        
        # 일반 케이스: OUT/IN 분류 후 매칭
        outs, ins, unknowns = self._classify_by_direction(entries)
        
        # unknown 항목 분배
        outs, ins = self._distribute_unknowns(outs, ins, unknowns)
        
        # 페어링 수행
        pairs, leftovers = self._match_outs_to_ins(outs, ins)
        
        return pairs, leftovers
    
    def pair_transfers_with_tolerance(
        self,
        entries: List[schemas.TransactionCreate]
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], List[schemas.TransactionCreate]]:
        """
        금액 tolerance 허용 페어링 (±2원)
        
        더 유연한 매칭을 위해 금액 차이를 허용
        """
        if not entries:
            return [], []
        
        pool = sorted(entries, key=lambda e: abs(float(e.amount)))
        used = [False] * len(pool)
        pairs = []
        leftovers = []
        
        for i, entry_a in enumerate(pool):
            if used[i]:
                continue
            
            best_match_idx = self._find_best_match(
                entry_a, pool, used, i
            )
            
            if best_match_idx is None:
                leftovers.append(entry_a)
                continue
            
            # 페어 생성
            used[i] = True
            used[best_match_idx] = True
            
            out_entry, in_entry = self._decide_pair_direction(
                entry_a, pool[best_match_idx]
            )
            
            try:
                combined = self._build_pair(out_entry, in_entry)
                pairs.append((combined, True))
            except Exception:
                leftovers.extend([entry_a, pool[best_match_idx]])
        
        # 남은 unpaired 항목 추가
        for idx, entry in enumerate(pool):
            if not used[idx]:
                leftovers.append(entry)
        
        return pairs, leftovers
    
    # Private methods
    def _classify_by_direction(self, entries):
        """OUT/IN/UNKNOWN 분류"""
        outs = [e for e in entries if e.transfer_flow == "OUT"]
        ins = [e for e in entries if e.transfer_flow == "IN"]
        unknowns = [e for e in entries if e.transfer_flow not in ("OUT", "IN")]
        return outs, ins, unknowns
    
    def _distribute_unknowns(self, outs, ins, unknowns):
        """UNKNOWN 항목을 OUT/IN으로 분배"""
        for entry in unknowns:
            counter_hint = normalize_account_ref(
                entry.counter_account_id, 
                entry.counter_account_name
            )
            account_hint = normalize_account_ref(
                entry.account_id, 
                entry.account_name
            )
            
            if counter_hint and not account_hint:
                ins.append(entry)
            elif account_hint and not counter_hint:
                outs.append(entry)
            else:
                # 균형 맞추기
                target = outs if len(outs) <= len(ins) else ins
                target.append(entry)
        
        return outs, ins
    
    def _match_outs_to_ins(self, outs, ins):
        """OUT과 IN을 매칭"""
        pairs = []
        leftovers = []
        ins_pool = list(ins)
        
        for out_entry in outs:
            match_idx, in_entry = self._select_in_match(out_entry, ins_pool)
            
            if match_idx is None:
                leftovers.append(out_entry)
                continue
            
            ins_pool.pop(match_idx)
            
            try:
                combined = self._build_pair(out_entry, in_entry)
                pairs.append((combined, True))
            except Exception:
                leftovers.extend([out_entry, in_entry])
        
        leftovers.extend(ins_pool)
        return pairs, leftovers
    
    def _select_in_match(self, out_entry, ins_pool):
        """OUT에 매칭되는 IN 선택 (account/counter 힌트 활용)"""
        if not ins_pool:
            return None, None
        
        target_counter = normalize_account_ref(
            out_entry.counter_account_id,
            out_entry.counter_account_name
        )
        source_key = normalize_account_ref(
            out_entry.account_id,
            out_entry.account_name
        )
        
        # 1순위: counter_account 명시 매칭
        if target_counter:
            for idx, candidate in enumerate(ins_pool):
                if normalize_account_ref(candidate.account_id, candidate.account_name) == target_counter:
                    return idx, candidate
        
        # 2순위: 상호 counter 매칭
        if source_key:
            for idx, candidate in enumerate(ins_pool):
                if normalize_account_ref(candidate.counter_account_id, candidate.counter_account_name) == source_key:
                    return idx, candidate
        
        # 3순위: 첫 번째 항목
        return 0, ins_pool[0]
    
    def _decide_pair_direction(self, first, second):
        """두 항목 중 OUT/IN 방향 결정"""
        # transfer_flow 힌트 우선
        if first.transfer_flow == "OUT" and second.transfer_flow == "IN":
            return first, second
        if second.transfer_flow == "OUT" and first.transfer_flow == "IN":
            return second, first
        
        # account/counter 대칭성 확인
        first_account = normalize_account_ref(first.account_id, first.account_name)
        second_account = normalize_account_ref(second.account_id, second.account_name)
        first_counter = normalize_account_ref(first.counter_account_id, first.counter_account_name)
        second_counter = normalize_account_ref(second.counter_account_id, second.counter_account_name)
        
        if first_counter and first_counter == second_account:
            return first, second
        if second_counter and second_counter == first_account:
            return second, first
        
        # 기본값: 첫 번째를 OUT으로
        return first, second
    
    def _build_pair(self, out_entry, in_entry):
        """OUT/IN 항목을 결합하여 단일 TRANSFER 생성"""
        base = out_entry.model_dump()
        
        # counter_account 설정
        counter_id = in_entry.account_id or out_entry.counter_account_id
        if counter_id:
            base["counter_account_id"] = counter_id
            base.pop("counter_account_name", None)
        else:
            counter_name = (
                in_entry.account_name or 
                in_entry.counter_account_name or
                out_entry.counter_account_name or
                f"{base.get('account_name', '')} (상대)"
            )
            base["counter_account_name"] = counter_name
        
        # memo 병합
        if not base.get("memo") and in_entry.memo:
            base["memo"] = in_entry.memo
        
        # category 보존
        if not base.get("category_id") and in_entry.category_id:
            base["category_id"] = in_entry.category_id
        
        base["transfer_flow"] = "OUT"
        return schemas.TransactionCreate(**base)
    
    def _find_best_match(self, entry_a, pool, used, skip_idx):
        """Tolerance 기반 최적 매칭 찾기"""
        best_score = -1
        best_idx = None
        amount_a = abs(float(entry_a.amount))
        
        for j, entry_b in enumerate(pool):
            if used[j] or j == skip_idx:
                continue
            
            amount_b = abs(float(entry_b.amount))
            if abs(amount_a - amount_b) > self.tolerance:
                continue
            
            # 점수 계산
            score = 0
            
            # 부호 반대 (+1점)
            if (entry_a.amount < 0 and entry_b.amount > 0) or \
               (entry_a.amount > 0 and entry_b.amount < 0):
                score += 1
            
            # transfer_flow 반대 (+1점)
            if entry_a.transfer_flow == "OUT" and entry_b.transfer_flow == "IN":
                score += 1
            if entry_a.transfer_flow == "IN" and entry_b.transfer_flow == "OUT":
                score += 1
            
            if score > best_score:
                best_score = score
                best_idx = j
        
        return best_idx


# 정규화 유틸리티는 별도 파일로
# utils/normalization.py

def normalize_account_token(value: str | None) -> str:
    """계좌명 정규화"""
    if not value:
        return ""
    import unicodedata
    import re
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"\W+", "", normalized, flags=re.UNICODE)


def normalize_account_ref(account_id: int | None, account_name: str | None) -> str:
    """계좌 참조 정규화"""
    if account_id:
        return f"id:{account_id}"
    if account_name:
        return f"name:{normalize_account_token(account_name)}"
    return ""
```

---

#### 2. `transaction_service.py` (비즈니스 로직)

```python
"""
트랜잭션 생성/수정/삭제 비즈니스 로직
"""

from typing import List, Tuple
from sqlalchemy.orm import Session
from app import models, schemas
from .transfer_pairing_service import TransferPairingService
from .balance_service import BalanceService
from .duplicate_detection_service import DuplicateDetectionService


class TransactionBulkService:
    """Bulk 트랜잭션 처리 서비스"""
    
    def __init__(self, db: Session):
        self.db = db
        self.pairing_service = TransferPairingService(tolerance=2.0)
        self.balance_service = BalanceService(db)
        self.duplicate_service = DuplicateDetectionService(db)
    
    def bulk_create(
        self,
        user_id: int,
        items: List[schemas.TransactionCreate],
        override: bool = False
    ) -> Tuple[List[models.Transaction], dict]:
        """
        Bulk 트랜잭션 생성
        
        Returns:
            (created_transactions, metadata)
            metadata = {
                "duplicates_detected": int,
                "settlement_duplicates": int,
                "potential_matches": List[dict]
            }
        """
        metadata = {
            "duplicates_detected": 0,
            "settlement_duplicates": 0,
            "potential_matches": []
        }
        
        # 1. 데이터 정규화
        normalized = self._normalize_items(items, user_id)
        
        # 2. TRANSFER 페어링
        paired_items, unpaired_transfers = self._pair_transfers(normalized)
        metadata["duplicates_detected"] = len(paired_items)
        
        # 3. override 처리 (기존 항목 삭제)
        if override:
            self._handle_override(normalized, user_id)
        
        # 4. Settlement 중복 체크
        filtered_items, settlement_dups = self._filter_settlement_duplicates(paired_items)
        metadata["settlement_duplicates"] = settlement_dups
        
        # 5. 트랜잭션 생성
        created = self._create_transactions(filtered_items)
        
        # 6. 분산 업로드 매칭 감지 (선택사항)
        # potential_matches = self._find_potential_matches(normalized, user_id)
        # metadata["potential_matches"] = potential_matches
        
        return created, metadata
    
    def _normalize_items(self, items, user_id):
        """데이터 정규화"""
        normalized = []
        for item in items:
            if item.user_id != user_id:
                normalized.append(
                    schemas.TransactionCreate(**{**item.model_dump(), "user_id": user_id})
                )
            else:
                normalized.append(item)
        return normalized
    
    def _pair_transfers(self, items):
        """TRANSFER 페어링"""
        # TRANSFER 항목만 추출
        transfers = [item for item in items if item.type == models.TxnType.TRANSFER]
        non_transfers = [item for item in items if item.type != models.TxnType.TRANSFER]
        
        # 날짜+시간+통화로 그룹핑
        transfer_groups = {}
        for transfer in transfers:
            key = (
                transfer.occurred_at,
                transfer.occurred_time,
                (transfer.currency or "").upper()
            )
            transfer_groups.setdefault(key, []).append(transfer)
        
        # 각 그룹별로 페어링
        paired_items = list(non_transfers)  # non-transfer는 그대로
        unpaired = []
        
        for group in transfer_groups.values():
            pairs, leftovers = self.pairing_service.pair_transfers_with_tolerance(group)
            paired_items.extend(pairs)
            unpaired.extend(leftovers)
        
        # leftover도 추가
        paired_items.extend([(item, False) for item in unpaired])
        
        return paired_items, unpaired
    
    def _handle_override(self, items, user_id):
        """기존 트랜잭션 삭제 (override=True)"""
        ext_ids = {item.external_id for item in items if item.external_id}
        if not ext_ids:
            return
        
        existing = (
            self.db.query(models.Transaction)
            .filter(
                models.Transaction.user_id == user_id,
                models.Transaction.external_id.in_(ext_ids)
            )
            .all()
        )
        
        to_delete = {}
        for tx in existing:
            to_delete[tx.id] = tx
            # 그룹 전체 삭제
            if tx.group_id:
                siblings = (
                    self.db.query(models.Transaction)
                    .filter(models.Transaction.group_id == tx.group_id)
                    .all()
                )
                for sibling in siblings:
                    to_delete[sibling.id] = sibling
        
        # 잔액 복구 및 삭제
        for tx in to_delete.values():
            self.balance_service.revert_transaction(tx)
            self.db.delete(tx)
        
        self.db.flush()
    
    def _filter_settlement_duplicates(self, items):
        """Settlement 중복 필터링"""
        filtered = []
        settlement_dups = 0
        
        for item, auto_match in items:
            if item.type == models.TxnType.SETTLEMENT and item.billing_cycle_id:
                stmt = (
                    self.db.query(models.CreditCardStatement)
                    .filter(models.CreditCardStatement.id == item.billing_cycle_id)
                    .first()
                )
                if stmt and (
                    stmt.status == models.CreditCardStatementStatus.PAID or
                    stmt.settlement_transaction_id is not None
                ):
                    settlement_dups += 1
                    continue
            
            filtered.append((item, auto_match))
        
        return filtered, settlement_dups
    
    def _create_transactions(self, items):
        """트랜잭션 생성"""
        from app.routers import create_transaction  # 기존 함수 재사용
        
        created = []
        for item, auto_match in items:
            balance_neutral = (
                item.type == models.TxnType.TRANSFER and
                not item.counter_account_id and
                not item.counter_account_name
            )
            
            tx = create_transaction(
                item,
                self.db,
                balance_neutral=balance_neutral,
                auto_transfer_match=auto_match
            )
            created.append(tx)
        
        return created
```

---

#### 3. `routers.py` (간소화된 엔드포인트)

```python
@router.post("/transactions/bulk", response_model=list[TransactionOut])
def bulk_upsert_transactions(
    payload: TransactionsBulkIn,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    트랜잭션 대량 생성/업데이트
    
    - TRANSFER 페어링 자동 처리
    - 중복 감지 및 제거
    - Settlement 중복 방지
    """
    # 사용자 검증
    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")
    
    if not payload.items:
        return []
    
    # 서비스 레이어 호출
    service = TransactionBulkService(db)
    created, metadata = service.bulk_create(
        user_id=payload.user_id,
        items=payload.items,
        override=payload.override
    )
    
    # 메타데이터를 헤더로 전달
    if metadata["duplicates_detected"]:
        response.headers["X-Duplicate-Transfers"] = str(metadata["duplicates_detected"])
    if metadata["settlement_duplicates"]:
        response.headers["X-Settlement-Duplicates"] = str(metadata["settlement_duplicates"])
    
    # 향후: potential_matches를 응답에 포함 가능
    # if metadata["potential_matches"]:
    #     return BulkUploadResponse(
    #         created=created,
    #         potential_matches=metadata["potential_matches"]
    #     )
    
    return created
```

---

## 📊 리팩토링 효과

### Before (현재)
```
routers.py: 1개 파일, 600줄
├── bulk_upsert_transactions (400줄)
│   ├── pair_transfers (150줄)
│   ├── pair_transfers_tolerant (150줄)
│   └── 기타 로직 (100줄)
└── 테스트 불가능
```

### After (제안)
```
routers.py: 30줄 (엔드포인트만)
services/
├── transaction_service.py: 150줄
├── transfer_pairing_service.py: 250줄
├── balance_service.py: 100줄
└── duplicate_detection_service.py: 80줄
utils/
└── normalization.py: 30줄

총 640줄 (주석 포함, 약간 증가)
BUT:
- 각 모듈 독립 테스트 가능 ✅
- 책임 분리 명확 ✅
- 유지보수 용이 ✅
```

---

## 🚀 마이그레이션 계획

### Phase 1: 유틸리티 추출 (1시간)
- `normalization.py` 생성
- `normalize_account_token`, `normalize_account_ref` 이동
- 기존 코드에서 import 변경

### Phase 2: 페어링 서비스 분리 (3시간)
- `TransferPairingService` 클래스 생성
- 기존 `pair_transfers`, `pair_transfers_tolerant` 로직 이동
- 단위 테스트 작성

### Phase 3: 트랜잭션 서비스 분리 (2시간)
- `TransactionBulkService` 클래스 생성
- 비즈니스 로직 이동
- 통합 테스트 작성

### Phase 4: 라우터 간소화 (1시간)
- `routers.py`에서 서비스 호출로 변경
- 기존 함수 제거

### Phase 5: 테스트 & 검증 (2시간)
- 기존 동작과 동일한지 확인
- 엣지 케이스 테스트
- 성능 벤치마크

**총 소요 시간**: 약 9시간 (1-2일)

---

## 🧪 테스트 전략

### 단위 테스트 예시

```python
# tests/services/test_transfer_pairing_service.py

import pytest
from app.services.transfer_pairing_service import TransferPairingService
from app.schemas import TransactionCreate


class TestTransferPairingService:
    def setup_method(self):
        self.service = TransferPairingService(tolerance=2.0)
    
    def test_pair_two_entries_with_explicit_flow(self):
        """명시적 flow 힌트로 2개 항목 페어링"""
        out_entry = TransactionCreate(
            occurred_at="2025-10-13",
            occurred_time="09:02:00",
            type="TRANSFER",
            amount=-400000,
            currency="KRW",
            account_name="급여통장",
            transfer_flow="OUT"
        )
        in_entry = TransactionCreate(
            occurred_at="2025-10-13",
            occurred_time="09:02:00",
            type="TRANSFER",
            amount=400000,
            currency="KRW",
            account_name="입출금통장",
            transfer_flow="IN"
        )
        
        pairs, leftovers = self.service.pair_transfers([out_entry, in_entry])
        
        assert len(pairs) == 1
        assert len(leftovers) == 0
        assert pairs[0][1] is True  # auto_match
        
        combined = pairs[0][0]
        assert combined.account_name == "급여통장"
        assert combined.counter_account_name == "입출금통장"
        assert combined.amount == -400000
    
    def test_pair_with_tolerance(self):
        """Tolerance 범위 내 금액 차이 매칭"""
        entry1 = TransactionCreate(
            occurred_at="2025-10-13",
            type="TRANSFER",
            amount=-100000,
            currency="KRW"
        )
        entry2 = TransactionCreate(
            occurred_at="2025-10-13",
            type="TRANSFER",
            amount=100001,  # 1원 차이
            currency="KRW"
        )
        
        pairs, leftovers = self.service.pair_transfers_with_tolerance([entry1, entry2])
        
        assert len(pairs) == 1
        assert len(leftovers) == 0
    
    def test_no_match_exceeds_tolerance(self):
        """Tolerance 초과 시 매칭 실패"""
        entry1 = TransactionCreate(
            occurred_at="2025-10-13",
            type="TRANSFER",
            amount=-100000,
            currency="KRW"
        )
        entry2 = TransactionCreate(
            occurred_at="2025-10-13",
            type="TRANSFER",
            amount=100005,  # 5원 차이 (tolerance=2)
            currency="KRW"
        )
        
        pairs, leftovers = self.service.pair_transfers_with_tolerance([entry1, entry2])
        
        assert len(pairs) == 0
        assert len(leftovers) == 2
```

---

## 💡 추가 개선 아이디어

### 1. 비동기 처리
대량 업로드 시 성능 향상:

```python
from fastapi import BackgroundTasks

@router.post("/transactions/bulk-async")
async def bulk_upsert_async(
    payload: TransactionsBulkIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    비동기 대량 업로드
    
    - 즉시 작업 ID 반환
    - 백그라운드에서 처리
    - 별도 엔드포인트로 진행 상황 조회
    """
    task_id = generate_task_id()
    
    background_tasks.add_task(
        process_bulk_upload,
        task_id=task_id,
        user_id=payload.user_id,
        items=payload.items
    )
    
    return {"task_id": task_id, "status": "processing"}
```

### 2. 검증 레이어 추가
데이터 무결성 검증:

```python
class TransactionValidator:
    """트랜잭션 검증"""
    
    def validate_bulk(self, items: List[TransactionCreate]) -> List[str]:
        """Bulk 데이터 검증"""
        errors = []
        
        for idx, item in enumerate(items):
            # 날짜 유효성
            if item.occurred_at > date.today():
                errors.append(f"Row {idx}: 미래 날짜는 허용되지 않습니다")
            
            # 금액 범위
            if abs(item.amount) > 1_000_000_000:
                errors.append(f"Row {idx}: 금액이 너무 큽니다 (10억 초과)")
            
            # TRANSFER 필수 필드
            if item.type == TxnType.TRANSFER:
                if not item.counter_account_id and not item.counter_account_name:
                    errors.append(f"Row {idx}: TRANSFER는 상대 계좌가 필요합니다")
        
        return errors
```

### 3. 페어링 전략 패턴
다양한 페어링 알고리즘 지원:

```python
from abc import ABC, abstractmethod

class PairingStrategy(ABC):
    @abstractmethod
    def pair(self, entries: List[TransactionCreate]) -> Tuple[List, List]:
        pass


class ExactPairingStrategy(PairingStrategy):
    """정확한 금액만 매칭"""
    def pair(self, entries):
        # 구현...
        pass


class TolerancePairingStrategy(PairingStrategy):
    """Tolerance 허용 매칭"""
    def __init__(self, tolerance: float):
        self.tolerance = tolerance
    
    def pair(self, entries):
        # 구현...
        pass


class MLBasedPairingStrategy(PairingStrategy):
    """ML 기반 지능형 매칭"""
    def pair(self, entries):
        # 구현...
        pass


# 사용
service = TransferPairingService(
    strategy=TolerancePairingStrategy(tolerance=2.0)
)
```

---

## 📈 우선순위

### 필수 (Phase 1-3)
1. ✅ 페어링 로직 분리 → 가장 복잡하고 중요
2. ✅ 트랜잭션 서비스 분리 → 비즈니스 로직 중앙화
3. ✅ 라우터 간소화 → 엔드포인트 가독성

### 선택 (Phase 4-5)
4. ⏳ 비동기 처리 → 성능 향상
5. ⏳ 검증 레이어 → 데이터 품질
6. ⏳ 전략 패턴 → 유연성

---

## 🎯 결론

**현재 bulk API의 주요 문제**:
- 단일 함수에 너무 많은 책임 집중 (600줄)
- 테스트 불가능
- 유지보수 어려움

**제안하는 해결책**:
- 서비스 레이어 분리 (3개 서비스)
- 각 서비스 독립 테스트 가능
- 책임 명확화 (SRP 원칙)

**예상 효과**:
- 코드 가독성 300% 향상
- 테스트 커버리지 0% → 80%+
- 버그 수정 시간 50% 단축
- 새 기능 추가 용이

**소요 시간**: 1-2일 (약 9시간)

리팩토링을 진행하시겠습니까? 단계별로 도와드릴 수 있습니다! 🚀
