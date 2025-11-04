"""
대량 트랜잭션 생성 서비스

책임:
- 데이터 정규화
- TRANSFER 그룹핑 및 페어링
- Override 처리
- Settlement 중복 필터링
- 트랜잭션 생성 오케스트레이션
"""

from typing import List, Tuple, Dict, Set, Optional
from datetime import time as dt_time
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app import models, schemas
from app.services.transfer_pairing_service import TransferPairingService
from app.services.transaction_service import TransactionBalanceService
from app.utils.normalization import normalize_account_ref, normalize_account_token


class TransactionBulkService:
    """
    대량 트랜잭션 생성 전문 서비스
    
    bulk_upsert_transactions의 비즈니스 로직을 캡슐화합니다.
    """
    
    def __init__(
        self, 
        db: Session,
        pairing_service: TransferPairingService | None = None
    ):
        """
        Args:
            db: SQLAlchemy 세션
            pairing_service: 페어링 서비스 (기본값: 새 인스턴스)
        """
        self.db = db
        self.pairing_service = pairing_service or TransferPairingService()
        self.balance_service = TransactionBalanceService(db)
    
    def bulk_create(
        self,
        user_id: int,
        items: List[schemas.TransactionCreate],
        override: bool = False
    ) -> Tuple[List[models.Transaction], Dict[str, int]]:
        """
        대량 트랜잭션 생성
        
        Args:
            user_id: 사용자 ID
            items: 생성할 트랜잭션 리스트
            override: external_id 기반 덮어쓰기 여부
        
        Returns:
            (created_transactions, metadata)
            - created_transactions: 생성된 트랜잭션 리스트
            - metadata: {"duplicate_transfers": int, "settlement_duplicates": int}
        """
        if not items:
            return [], {"duplicate_transfers": 0, "settlement_duplicates": 0, "db_transfer_matches": 0, "existing_duplicates": 0}
        
        # 1. 데이터 정규화
        normalized = self._normalize_items(items, user_id)
        
        # 2. TRANSFER 그룹핑 및 페어링 (동일 업로드 내)
        items_to_create, duplicates_detected = self._pair_transfers(normalized)

        # 2-1. 기존 DB와의 매칭 감지 및 중복 제거 (분산 업로드 대응)
        items_to_create, db_transfer_matches = self._apply_db_transfer_matches(
            user_id, items_to_create
        )
        
        # 3. Override 처리
        if override:
            self._handle_override(user_id, normalized)
        
        # 3-1. 기존 external_id 중복 필터링 (멱등 강화)
        items_to_create, existing_duplicates, existing_txns = self._filter_existing_by_external_id(
            user_id, items_to_create
        )

        # 3-2. 자연키 기반 중복 필터링 (파일 위치 변경 등으로 external_id 달라진 경우)
        items_to_create, natural_duplicates = self._filter_natural_duplicates(
            user_id, items_to_create
        )

        # 4. Settlement 중복 필터링
        filtered_to_create, settlement_duplicates = self._filter_settlement_duplicates(
            items_to_create
        )
        
        # 5. 트랜잭션 생성
        created = self._create_transactions(filtered_to_create)
        
        # 기존 트랜잭션도 결과에 포함 (idempotent 업로드 시나리오)
        all_transactions = list(existing_txns) + created
        
        metadata = {
            "duplicate_transfers": duplicates_detected,
            "settlement_duplicates": settlement_duplicates,
            "db_transfer_matches": db_transfer_matches,
            "natural_duplicates": natural_duplicates,
            "existing_duplicates": existing_duplicates,
        }
        
        return all_transactions, metadata
    
    # ==================== Private Methods ====================
    
    def _normalize_items(
        self, 
        items: List[schemas.TransactionCreate], 
        user_id: int
    ) -> List[schemas.TransactionCreate]:
        """user_id override 정규화"""
        normalized = []
        for item in items:
            if item.user_id != user_id:
                normalized.append(
                    schemas.TransactionCreate(
                        **{**item.model_dump(), "user_id": user_id}
                    )
                )
            else:
                normalized.append(item)
        return normalized
    
    def _pair_transfers(
        self, 
        normalized: List[schemas.TransactionCreate]
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], int]:
        """
        TRANSFER 페어링
        
        Returns:
            (items_to_create, duplicates_detected)
            - items_to_create: [(TransactionCreate, is_auto_match), ...]
            - duplicates_detected: 페어링된 항목 수
        """
        # TRANSFER 그룹핑 by (date, time, currency)
        transfer_groups: Dict[Tuple, List[schemas.TransactionCreate]] = {}
        for item in normalized:
            if item.type == models.TxnType.TRANSFER:
                key = (item.occurred_at, item.occurred_time, (item.currency or "").upper())
                transfer_groups.setdefault(key, []).append(item)
        
        items_to_create: List[Tuple[schemas.TransactionCreate, bool]] = []
        duplicates_detected = 0
        
        # Non-TRANSFER 항목은 그대로 통과
        for item in normalized:
            if item.type != models.TxnType.TRANSFER:
                items_to_create.append((item, False))
        
        # TRANSFER 그룹별 페어링 (tolerance ±2원)
        for key, entries in transfer_groups.items():
            pairs, leftovers = self.pairing_service.pair_transfers_with_tolerance(
                entries
            )
            
            if pairs:
                duplicates_detected += len(pairs)
                items_to_create.extend(pairs)
            
            for leftover in leftovers:
                items_to_create.append((leftover, False))
        
        return items_to_create, duplicates_detected

    def _apply_db_transfer_matches(
        self,
        user_id: int,
        items_to_create: List[Tuple[schemas.TransactionCreate, bool]],
        amount_tolerance: float = 2.0,
        time_tolerance_seconds: int = 60,
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], int]:
        """
        기존 DB의 트랜잭션과 신규 이체성 항목을 매칭하여
        분산 업로드로 인한 중복 생성을 방지합니다.

        transfer_flow 힌트가 있는 INCOME/EXPENSE도 매칭 대상에 포함합니다.

        현재 단계에서는 안전을 위해 "신규 항목 생성을 건너뛰는" 수준만 수행합니다.
        (향후: 기존 항목으로 카운터 정보를 병합하여 단일 전표로 승격 가능)

        Returns:
            (filtered_items, match_count)
        """
        if not items_to_create:
            return items_to_create, 0

        filtered: List[Tuple[schemas.TransactionCreate, bool]] = []
        match_count = 0

        # Query helper: build lazily chainable query mock-friendly
        def _query_candidates(item: schemas.TransactionCreate):
            q = (
                self.db.query(models.Transaction)
                .filter(models.Transaction.user_id == user_id)
                # TRANSFER 또는 INCOME/EXPENSE (이체성 거래 가능성)
                .filter(models.Transaction.type.in_([
                    models.TxnType.TRANSFER,
                    models.TxnType.INCOME,
                    models.TxnType.EXPENSE
                ]))
                .filter(models.Transaction.occurred_at == item.occurred_at)
                .filter(models.Transaction.currency == (item.currency or "").upper())
            )
            return q

        def _time_close(a: Optional[dt_time], b: Optional[dt_time]) -> bool:
            if not a or not b:
                return True  # 시간 정보 없으면 날짜만으로 허용
            a_sec = a.hour * 3600 + a.minute * 60 + a.second
            b_sec = b.hour * 3600 + b.minute * 60 + b.second
            return abs(a_sec - b_sec) <= time_tolerance_seconds

        def _is_match(new: schemas.TransactionCreate, existing: models.Transaction) -> bool:
            try:
                print(
                    f"[db-transfer-cand] new_ft=({getattr(new,'from_account_id',None)},{getattr(new,'to_account_id',None)}), ex_ft=({getattr(existing,'from_account_id',None)},{getattr(existing,'to_account_id',None)}), ex_legacy=({getattr(existing,'account_id',None)},{getattr(existing,'counter_account_id',None)})"
                )
            except Exception:
                pass
            # 통화는 쿼리에서 이미 일치
            # 금액: 부호 반대 + 절대값 차이 허용
            if not (new.amount and existing.amount is not None):
                return False
            if (new.amount > 0 and existing.amount > 0) or (new.amount < 0 and existing.amount < 0):
                return False
            if abs(abs(float(new.amount)) - abs(float(existing.amount))) > amount_tolerance:
                return False
            # 시간 근접성
            time_ok = _time_close(new.occurred_time, existing.occurred_time)
            if not time_ok:
                return False
            
            # 계좌 힌트 상호 일치 검증 (있으면)
            # 신규 항목: 제공된 주 계좌를 우선 사용 (from 우선, 없으면 to)
            new_from = normalize_account_ref(getattr(new, "from_account_id", None), getattr(new, "from_account_name", None))
            new_to = normalize_account_ref(getattr(new, "to_account_id", None), getattr(new, "to_account_name", None))
            if new_from:
                new_account = new_from
                new_counter = new_to
            else:
                new_account = new_to
                new_counter = new_from

            # 기존 항목: ORM/hybrid 또는 더미 객체 모두 지원 (from/to가 우선, 없으면 legacy account/counter)
            ex_from = normalize_account_ref(
                getattr(existing, "from_account_id", None) if hasattr(existing, "from_account_id") else getattr(existing, "account_id", None),
                None,
            ) or normalize_account_ref(getattr(existing, "account_id", None), None)
            ex_to = normalize_account_ref(
                getattr(existing, "to_account_id", None) if hasattr(existing, "to_account_id") else getattr(existing, "counter_account_id", None),
                None,
            ) or normalize_account_ref(getattr(existing, "counter_account_id", None), None)

            if ex_from:
                ex_account = ex_from
                ex_counter = ex_to
            else:
                ex_account = ex_to
                ex_counter = ex_from

            # 강한 매칭: 한쪽의 counter == 상대의 account
            strong = (new_counter and new_counter == ex_account) or (ex_counter and ex_counter == new_account)
            if strong:
                return True
            
            # 약한 매칭: counter 정보 없으면 날짜+시간+금액+부호 반대만으로 허용
            # (분산 업로드에서 transfer_flow 힌트만 있고 counter 정보가 없는 경우)
            if not new_counter and not ex_counter:
                # 서로 다른 계좌인지 확인 (같은 계좌 간 이체는 불가)
                if new_account and ex_account and new_account != ex_account:
                    try:
                        print(
                            f"[db-transfer-cmp] new_acc={new_account}, new_ctr={new_counter}, ex_acc={ex_account}, ex_ctr={ex_counter}, strong={strong}, time_ok={time_ok}, new_amt={new.amount}, ex_amt={existing.amount}"
                        )
                    except Exception:
                        pass
                    return True

            return False

        for item, auto_match in items_to_create:
            # 신규 이체성 항목(TRANSFER 또는 transfer_flow 힌트 있는 것) 중 자동페어가 아니고, DB와 매칭 가능하면 생성 건너뜀
            is_transfer_like = (
                item.type == models.TxnType.TRANSFER 
                or getattr(item, 'transfer_flow', None) is not None
            )
            
            if is_transfer_like and not auto_match:
                try:
                    print(
                        f"[db-transfer-scan] item(date={item.occurred_at}, time={item.occurred_time}, amt={item.amount}, type={item.type.value}, flow={getattr(item,'transfer_flow',None)}, cur={item.currency})"
                    )
                except Exception:
                    pass
                candidates = _query_candidates(item).all()
                try:
                    print(f"[db-transfer-scan] candidates={len(candidates)} for date={item.occurred_at}")
                except Exception:
                    pass
                found = next((ex for ex in candidates if _is_match(item, ex)), None)
                if found:
                    try:
                        # 최소 디버그 로그: 테스트에서 매칭 관찰용
                        print(
                            f"[db-transfer-match] new(date={item.occurred_at}, time={item.occurred_time}, amt={item.amount}, acc={getattr(item, 'from_account_id', None) or getattr(item, 'to_account_id', None)}) -> existing(id={getattr(found, 'id', None)}, amt={getattr(found, 'amount', None)})"
                        )
                    except Exception:
                        pass
                    match_count += 1
                    # 향후: found에 counter 정보 보강 및 balance 반영 로직 추가 가능
                    continue  # 생성 스킵
            else:
                try:
                    print(
                        f"[db-transfer-skip] item considered non-transfer-like or auto-matched: type={getattr(item,'type',None)}, flow={getattr(item,'transfer_flow',None)}, auto={auto_match}"
                    )
                except Exception:
                    pass

            filtered.append((item, auto_match))

        return filtered, match_count

    def _filter_existing_by_external_id(
        self,
        user_id: int,
        items_to_create: List[Tuple[schemas.TransactionCreate, bool]],
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], int, List[models.Transaction]]:
        """
        이미 DB에 존재하는 (user_id, external_id) 항목을 사전에 제외하여
        재업로드 시 중복 생성을 방지합니다.

        Returns:
            (filtered_items, existing_count, existing_transactions)
        """
        # 수집
        ext_ids: Set[str] = set(
            str(item.external_id)
            for item, _ in items_to_create
            if getattr(item, "external_id", None) is not None
        )
        if not ext_ids:
            return items_to_create, 0, []

        # 조회 - 전체 트랜잭션 객체 반환
        existing = (
            self.db.query(models.Transaction)
            .filter(
                models.Transaction.user_id == user_id,
                models.Transaction.external_id.in_(ext_ids),
            )
            .all()
        )
        existing_set = {tx.external_id for tx in existing if tx.external_id}
        if not existing_set:
            return items_to_create, 0, []

        # 필터링
        filtered: List[Tuple[schemas.TransactionCreate, bool]] = []
        skipped = 0
        for item, auto_match in items_to_create:
            ext_id = getattr(item, "external_id", None)
            if ext_id and ext_id in existing_set:
                skipped += 1
                continue
            filtered.append((item, auto_match))

        return filtered, skipped, existing

    def _filter_natural_duplicates(
        self,
        user_id: int,
        items_to_create: List[Tuple[schemas.TransactionCreate, bool]],
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], int]:
        """
        external_id가 달라도 동일 거래로 추정되는 항목을 필터링합니다.
        기준(보수적):
          - user_id 동일
          - occurred_at 동일
          - occurred_time 동일(있다면)
          - type 동일
          - currency 동일 (대문자)
          - account 동일 (id 매칭; 이름→id 해석 가능할 때만 적용)
          - amount 동일 또는 부호만 반대(절대값 동일)
        적용 대상: 주로 importer 생성 건(예: external_id가 "banksalad-" 접두사)만 필터링
        """
        if not items_to_create:
            return items_to_create, 0

        # 후보 account name 수집 후 일괄 조회 (이미 id가 있으면 생략)
        name_set: Set[str] = set()
        for item, _ in items_to_create:
            primary_id = getattr(item, "from_account_id", None) or getattr(item, "to_account_id", None)
            if primary_id:
                continue
            if getattr(item, "from_account_name", None):
                name_set.add(item.from_account_name)
            elif getattr(item, "to_account_name", None):
                name_set.add(item.to_account_name)
        name_to_id: Dict[str, int] = {}
        if name_set:
            accounts = (
                self.db.query(models.Account)
                .filter(models.Account.user_id == user_id)
                .filter(models.Account.name.in_(list(name_set)))
                .all()
            )
            for acc in accounts:
                name_to_id[acc.name] = acc.id

        filtered: List[Tuple[schemas.TransactionCreate, bool]] = []
        dup_count = 0

        for item, auto_match in items_to_create:
            ext = getattr(item, "external_id", "") or ""
            if not (ext.startswith("banksalad-")):
                # 다른 소스는 보수적으로 통과
                filtered.append((item, auto_match))
                continue

            # 계정 id 해석
            account_id: Optional[int] = getattr(item, "from_account_id", None) or getattr(item, "to_account_id", None)
            if account_id is None and getattr(item, "from_account_name", None):
                account_id = name_to_id.get(item.from_account_name)
            if account_id is None and getattr(item, "to_account_name", None):
                account_id = name_to_id.get(item.to_account_name)
            if account_id is None:
                # 계정 id 확인 불가 시 스킵 (생성 단계에서 처리)
                filtered.append((item, auto_match))
                continue

            q = (
                self.db.query(models.Transaction)
                .filter(models.Transaction.user_id == user_id)
                .filter(models.Transaction.type == item.type)
                .filter(models.Transaction.occurred_at == item.occurred_at)
                .filter(
                    or_(
                        models.Transaction.from_account_id == account_id,
                        models.Transaction.to_account_id == account_id,
                    )
                )
                .filter(models.Transaction.currency == (item.currency or "").upper())
            )
            if getattr(item, "occurred_time", None) is not None:
                q = q.filter(models.Transaction.occurred_time == item.occurred_time)

            amt = float(item.amount)
            q = q.filter(or_(models.Transaction.amount == amt, models.Transaction.amount == -amt))

            existing = q.first()
            if existing:
                dup_count += 1
                continue

            filtered.append((item, auto_match))

        return filtered, dup_count
    
    def _handle_override(
        self, 
        user_id: int, 
        normalized: List[schemas.TransactionCreate]
    ) -> None:
        """
        Override 처리: external_id 기반 기존 트랜잭션 삭제
        """
        ext_ids = {item.external_id for item in normalized if item.external_id}
        if not ext_ids:
            return
        
        # 기존 트랜잭션 조회
        existing = (
            self.db.query(models.Transaction)
            .filter(
                models.Transaction.user_id == user_id,
                models.Transaction.external_id.in_(ext_ids),
            )
            .all()
        )
        
        # 삭제 대상 수집 (group_id 포함)
        to_delete: Dict[int, models.Transaction] = {}
        for tx in existing:
            to_delete[tx.id] = tx
            if tx.group_id:
                siblings = (
                    self.db.query(models.Transaction)
                    .filter(models.Transaction.group_id == tx.group_id)
                    .all()
                )
                for s in siblings:
                    to_delete[s.id] = s
        
        # 삭제 수행 (잔액 되돌림 포함)
        for tx in to_delete.values():
            self._sync_check_card_auto_deduct(tx, remove=True)
            
            if not self._is_effectively_neutral_txn(tx):
                if (
                    tx.type == models.TxnType.TRANSFER
                    and tx.is_auto_transfer_match
                    and (tx.to_account_id or tx.from_account_id)
                ):
                    self.balance_service.revert_signed_transfer(
                        tx.from_account_id,
                        tx.to_account_id,
                        float(tx.amount),
                    )
                else:
                    primary_account = tx.from_account_id or tx.to_account_id
                    if primary_account is not None:
                        self.balance_service.apply_signed_delta(primary_account, -float(tx.amount))
                    else:
                        # TODO: directional metadata missing – manual reconciliation required
                        pass
            
            self.db.delete(tx)
        
        self.db.flush()
    
    def _filter_settlement_duplicates(
        self, 
        items_to_create: List[Tuple[schemas.TransactionCreate, bool]]
    ) -> Tuple[List[Tuple[schemas.TransactionCreate, bool]], int]:
        """
        Settlement 중복 필터링
        
        Returns:
            (filtered_items, settlement_duplicates_count)
        """
        filtered = []
        settlement_duplicates = 0
        
        for item, auto_match in items_to_create:
            # SETTLEMENT 타입이고 billing_cycle_id가 있는 경우
            if (
                item.type == models.TxnType.SETTLEMENT 
                and item.billing_cycle_id is not None
            ):
                stmt = (
                    self.db.query(models.CreditCardStatement)
                    .filter(models.CreditCardStatement.id == item.billing_cycle_id)
                    .first()
                )
                
                # 이미 결제됨 또는 settlement_transaction_id가 있으면 스킵
                if stmt and (
                    stmt.status == models.CreditCardStatementStatus.PAID 
                    or stmt.settlement_transaction_id is not None
                ):
                    settlement_duplicates += 1
                    continue
            
            filtered.append((item, auto_match))
        
        return filtered, settlement_duplicates
    
    def _create_transactions(
        self, 
        items_to_create: List[Tuple[schemas.TransactionCreate, bool]]
    ) -> List[models.Transaction]:
        """
        트랜잭션 생성
        
        Args:
            items_to_create: [(TransactionCreate, is_auto_match), ...]
        
        Returns:
            생성된 트랜잭션 리스트
        """
        from app.routers import create_transaction
        
        created = []
        for item, auto_match in items_to_create:
            # balance_neutral 결정
            balance_neutral = (
                item.type == models.TxnType.TRANSFER
                and not item.counter_account_id
                and not item.counter_account_name
            )
            
            created_tx = create_transaction(
                item,
                self.db,
                balance_neutral=balance_neutral,
                auto_transfer_match=auto_match,
            )
            created.append(created_tx)
        
        return created
    
    # ==================== Helper Methods (routers.py에서 사용) ====================
    
    def _sync_check_card_auto_deduct(
        self, 
        tx: models.Transaction, 
        remove: bool = False
    ) -> None:
        """Card auto deduct 동기화 (routers.py의 _sync_check_card_auto_deduct 호출)"""
        from app.routers import _sync_check_card_auto_deduct
        _sync_check_card_auto_deduct(self.db, tx, remove=remove)
    
    def _is_effectively_neutral_txn(self, tx: models.Transaction) -> bool:
        """트랜잭션이 실질적으로 잔액 중립인지 확인 (routers.py 함수 호출)"""
        from app.routers import _is_effectively_neutral_txn
        return _is_effectively_neutral_txn(tx)
    
    def _revert_single_transfer_effect(
        self,
        account_id: int,
        counter_account_id: int,
        amount: float,
    ) -> None:
        """TRANSFER 효과 되돌림 (신규 directional 모델 대응)"""
        self.balance_service.revert_signed_transfer(account_id, counter_account_id, amount)

    def _apply_balance(self, account_id: int, amount: float) -> None:
        """잔액 적용 (legacy delta 호환)"""
        self.balance_service.apply_signed_delta(account_id, amount)
