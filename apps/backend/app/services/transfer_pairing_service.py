"""
TRANSFER 페어링 전문 서비스

책임:
- OUT/IN 방향 결정
- 페어 생성
- Tolerance 기반 매칭
"""

from typing import List, Tuple, Optional
from app import schemas
from app.utils.normalization import normalize_account_token, normalize_account_ref


class TransferPairingService:
    """
    TRANSFER 페어링 전문 클래스
    
    이체 트랜잭션들을 OUT/IN으로 페어링하여
    단일 TRANSFER 거래로 결합합니다.
    """
    
    def __init__(self, tolerance: float = 2.0):
        """
        Args:
            tolerance: 금액 차이 허용 범위 (기본 2원)
        """
        self.tolerance = tolerance
    
    def pair_transfers(
        self, 
        entries: List[schemas.TransactionCreate]
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], List[schemas.TransactionCreate]]:
        """
        TRANSFER 항목들을 OUT/IN으로 페어링
        
        Args:
            entries: TRANSFER 타입 트랜잭션 리스트
        
        Returns:
            (paired_items, unpaired_items)
            - paired_items: [(combined_transfer, is_auto_match), ...]
            - unpaired_items: [leftover_transfer, ...]
        """
        if not entries:
            return [], []
        
        # 2개 항목 특수 케이스 (가장 흔한 경우)
        if len(entries) == 2:
            return self._pair_two_entries(entries)
        
        # 일반 케이스: OUT/IN 분류 후 매칭
        outs, ins, unknowns = self._classify_by_direction(entries)
        
        # unknown 항목 분배
        outs, ins = self._distribute_unknowns(outs, ins, unknowns)
        
        # 페어링 수행
        pairs, leftovers = self._match_outs_to_ins(outs, ins)
        
        # 마지막 시도: 남은 항목들 중 짝수개면 강제 페어링
        if not pairs and len(leftovers) >= 2:
            fallback_pairs, final_leftovers = self._fallback_pairing(leftovers)
            pairs.extend(fallback_pairs)
            leftovers = final_leftovers
        
        return pairs, leftovers
    
    def pair_transfers_with_tolerance(
        self,
        entries: List[schemas.TransactionCreate]
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], List[schemas.TransactionCreate]]:
        """
        금액 tolerance 허용 페어링 (±2원)
        
        더 유연한 매칭을 위해 금액 차이를 허용합니다.
        
        Args:
            entries: TRANSFER 타입 트랜잭션 리스트
        
        Returns:
            (paired_items, unpaired_items)
        """
        if not entries:
            return [], []
        
        # 금액 기준 정렬 (매칭 효율성 향상)
        pool = sorted(entries, key=lambda e: abs(float(e.amount)))
        used = [False] * len(pool)
        pairs = []
        leftovers = []
        
        # 각 항목에 대해 최적 매치 찾기
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
                pairs.append((combined, True))  # auto_match=True
            except Exception:
                # 페어 생성 실패 시 둘 다 leftover로
                leftovers.extend([entry_a, pool[best_match_idx]])
        
        # 남은 unpaired 항목 추가
        for idx, entry in enumerate(pool):
            if not used[idx] and entry not in leftovers:
                leftovers.append(entry)
        
        return pairs, leftovers
    
    # ==================== Private Methods ====================
    
    def _pair_two_entries(
        self, 
        entries: List[schemas.TransactionCreate]
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], List[schemas.TransactionCreate]]:
        """2개 항목 특수 케이스 처리"""
        primary, counterpart = self._decide_pair_direction(entries[0], entries[1])
        try:
            combined = self._build_pair(primary, counterpart)
            return [(combined, True)], []
        except Exception:
            return [], entries
    
    def _classify_by_direction(
        self, 
        entries: List[schemas.TransactionCreate]
    ) -> Tuple[List, List, List]:
        """OUT/IN/UNKNOWN 분류"""
        outs = [e for e in entries if e.transfer_flow == "OUT"]
        ins = [e for e in entries if e.transfer_flow == "IN"]
        unknowns = [e for e in entries if e.transfer_flow not in ("OUT", "IN")]
        return outs, ins, unknowns
    
    def _distribute_unknowns(
        self, 
        outs: List[schemas.TransactionCreate], 
        ins: List[schemas.TransactionCreate], 
        unknowns: List[schemas.TransactionCreate]
    ) -> Tuple[List, List]:
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
            
            # counter만 있으면 IN (상대방이 명시됨)
            if counter_hint and not account_hint:
                ins.append(entry)
            # account만 있으면 OUT (내 계좌에서 나감)
            elif account_hint and not counter_hint:
                outs.append(entry)
            else:
                # 균형 맞추기: 적은 쪽에 추가
                target = outs if len(outs) <= len(ins) else ins
                target.append(entry)
        
        return outs, ins
    
    def _match_outs_to_ins(
        self, 
        outs: List[schemas.TransactionCreate], 
        ins: List[schemas.TransactionCreate]
    ) -> Tuple[List, List]:
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
    
    def _select_in_match(
        self, 
        out_entry: schemas.TransactionCreate, 
        ins_pool: List[schemas.TransactionCreate]
    ) -> Tuple[Optional[int], Optional[schemas.TransactionCreate]]:
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
                candidate_key = normalize_account_ref(
                    candidate.account_id, 
                    candidate.account_name
                )
                if candidate_key == target_counter:
                    return idx, candidate
        
        # 2순위: 상호 counter 매칭 (A의 counter = B의 account)
        if source_key:
            for idx, candidate in enumerate(ins_pool):
                candidate_counter = normalize_account_ref(
                    candidate.counter_account_id, 
                    candidate.counter_account_name
                )
                if candidate_counter == source_key:
                    return idx, candidate
        
        # 3순위: counter 힌트 교차 매칭
        if target_counter:
            for idx, candidate in enumerate(ins_pool):
                candidate_counter = normalize_account_ref(
                    candidate.counter_account_id, 
                    candidate.counter_account_name
                )
                if candidate_counter == target_counter:
                    return idx, candidate
        
        # 4순위: 첫 번째 항목 (fallback)
        return 0, ins_pool[0]
    
    def _decide_pair_direction(
        self, 
        first: schemas.TransactionCreate, 
        second: schemas.TransactionCreate
    ) -> Tuple[schemas.TransactionCreate, schemas.TransactionCreate]:
        """두 항목 중 OUT/IN 방향 결정"""
        # 0순위: 금액 부호 (음수=OUT, 양수=IN)
        first_amount = float(first.amount)
        second_amount = float(second.amount)
        
        # 한쪽이 음수, 한쪽이 양수면 음수를 OUT으로
        if first_amount < 0 and second_amount > 0:
            return first, second
        if second_amount < 0 and first_amount > 0:
            return second, first
        
        # 1순위: transfer_flow 힌트
        if first.transfer_flow == "OUT" and second.transfer_flow == "IN":
            return first, second
        if second.transfer_flow == "OUT" and first.transfer_flow == "IN":
            return second, first
        if first.transfer_flow == "OUT" and second.transfer_flow != "OUT":
            return first, second
        if second.transfer_flow == "OUT" and first.transfer_flow != "OUT":
            return second, first
        if first.transfer_flow == "IN" and second.transfer_flow != "IN":
            return second, first
        if second.transfer_flow == "IN" and first.transfer_flow != "IN":
            return first, second
        
        # 2순위: account/counter 대칭성 확인
        first_account = normalize_account_ref(first.account_id, first.account_name)
        second_account = normalize_account_ref(second.account_id, second.account_name)
        first_counter = normalize_account_ref(first.counter_account_id, first.counter_account_name)
        second_counter = normalize_account_ref(second.counter_account_id, second.counter_account_name)
        
        if first_counter and first_counter == second_account:
            return first, second
        if second_counter and second_counter == first_account:
            return second, first
        
        # 3순위: counter 정보 기준 (counter가 있는 쪽을 OUT으로)
        if first_counter and not second_counter:
            return first, second
        if second_counter and not first_counter:
            return second, first
        
        # 최종: 결정론적 정렬 (키 비교)
        if first_account <= second_account:
            return first, second
        return second, first
    
    def _build_pair(
        self, 
        out_entry: schemas.TransactionCreate, 
        in_entry: schemas.TransactionCreate
    ) -> schemas.TransactionCreate:
        """OUT/IN 항목을 결합하여 단일 TRANSFER 생성"""
        base = out_entry.model_dump()

        # 자동 페어링 결과는 항상 출금 방향으로 저장되도록 금액을 음수로 강제한다.
        base["amount"] = -abs(float(base["amount"]))
        
        source_account_key = normalize_account_ref(out_entry.account_id, out_entry.account_name)
        
        # counter_account 설정
        def find_counter_id(candidate: schemas.TransactionCreate) -> Optional[int]:
            """source와 다른 계좌 ID 찾기"""
            if candidate.account_id:
                candidate_key = normalize_account_ref(candidate.account_id, None)
                if candidate_key != source_account_key:
                    return candidate.account_id
            
            if candidate.counter_account_id:
                candidate_key = normalize_account_ref(candidate.counter_account_id, None)
                if candidate_key != source_account_key:
                    return candidate.counter_account_id
            
            return None
        
        counter_id = find_counter_id(in_entry) or find_counter_id(out_entry)
        
        if counter_id is not None:
            base["counter_account_id"] = counter_id
            base.pop("counter_account_name", None)
        else:
            # counter_name 설정
            def find_counter_name(candidate: schemas.TransactionCreate) -> Optional[str]:
                """source와 다른 계좌명 찾기"""
                source_token = normalize_account_token(base.get("account_name"))
                
                for name in [candidate.account_name, candidate.counter_account_name]:
                    if not name:
                        continue
                    if normalize_account_token(name) != source_token:
                        return name
                
                return None
            
            counter_name = (
                find_counter_name(in_entry) or 
                find_counter_name(out_entry) or
                out_entry.counter_account_name or
                f"{base.get('account_name', '')} (상대)"
            )
            base["counter_account_name"] = counter_name
        
        # memo 병합
        if not base.get("memo") and in_entry.memo:
            base["memo"] = in_entry.memo
        
        # category 보존 (OUT 우선, IN fallback)
        if not base.get("category_id") and in_entry.category_id:
            base["category_id"] = in_entry.category_id
        
        if (
            not base.get("category_id") and
            not (base.get("category_group_name") and base.get("category_name")) and
            in_entry.category_group_name and in_entry.category_name
        ):
            base["category_group_name"] = in_entry.category_group_name
            base["category_name"] = in_entry.category_name
        
        base["transfer_flow"] = "OUT"
        return schemas.TransactionCreate(**base)
    
    def _find_best_match(
        self, 
        entry_a: schemas.TransactionCreate, 
        pool: List[schemas.TransactionCreate], 
        used: List[bool], 
        skip_idx: int
    ) -> Optional[int]:
        """Tolerance 기반 최적 매칭 찾기"""
        best_score = -1
        best_idx = None
        amount_a = abs(float(entry_a.amount))
        
        for j, entry_b in enumerate(pool):
            if used[j] or j == skip_idx:
                continue
            
            amount_b = abs(float(entry_b.amount))
            
            # Tolerance 체크
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
    
    def _fallback_pairing(
        self, 
        leftovers: List[schemas.TransactionCreate]
    ) -> Tuple[List, List]:
        """마지막 시도: 남은 항목들 강제 페어링"""
        pairs = []
        remaining = []
        unprocessed = list(leftovers)
        
        while len(unprocessed) >= 2:
            a = unprocessed.pop(0)
            b = unprocessed.pop(0)
            primary, counterpart = self._decide_pair_direction(a, b)
            try:
                combined = self._build_pair(primary, counterpart)
                pairs.append((combined, True))
            except Exception:
                remaining.extend([a, b])
        
        remaining.extend(unprocessed)
        return pairs, remaining
