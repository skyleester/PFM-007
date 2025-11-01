"""
TransactionBulkService 테스트
"""

import pytest
from datetime import date
from unittest.mock import MagicMock
from app.services import TransactionBulkService
from app import schemas
from app.models import TxnType


class TestTransactionBulkService:
    """TransactionBulkService 기본 테스트"""
    
    @pytest.fixture
    def mock_db(self):
        """Mock DB 세션"""
        return MagicMock()
    
    @pytest.fixture
    def service(self, mock_db):
        """서비스 인스턴스"""
        return TransactionBulkService(mock_db)
    
    def test_normalize_items(self, service):
        """user_id override 정규화 테스트"""
        items = [
            schemas.TransactionCreate(
                user_id=999,  # 다른 user_id
                account_id=10,
                amount=-1000.0,
                occurred_at=date(2025, 1, 1),
                type=TxnType.TRANSFER,
                currency="KRW",
                transfer_flow="OUT",
                counter_account_id=20
            ),
            schemas.TransactionCreate(
                user_id=1,  # 올바른 user_id
                account_id=20,
                amount=1000.0,
                occurred_at=date(2025, 1, 1),
                type=TxnType.TRANSFER,
                currency="KRW",
                transfer_flow="IN"
            ),
        ]
        
        normalized = service._normalize_items(items, user_id=1)
        
        assert len(normalized) == 2
        assert all(item.user_id == 1 for item in normalized)
        assert normalized[0].account_id == 10
        assert normalized[1].account_id == 20
    
    def test_pair_transfers_basic(self, service):
        """TRANSFER 페어링 기본 테스트"""
        items = [
            schemas.TransactionCreate(
                user_id=1,
                account_id=10,
                amount=-5000.0,
                occurred_at=date(2025, 1, 15),
                type=TxnType.TRANSFER,
                currency="KRW",
                transfer_flow="OUT",
                counter_account_id=20
            ),
            schemas.TransactionCreate(
                user_id=1,
                account_id=20,
                amount=5000.0,
                occurred_at=date(2025, 1, 15),
                type=TxnType.TRANSFER,
                currency="KRW",
                transfer_flow="IN"
            ),
        ]
        
        items_to_create, duplicates = service._pair_transfers(items)
        
        # 2개가 페어링되어 1개로 합쳐짐
        assert len(items_to_create) == 1
        assert duplicates == 1
        
        combined, is_auto = items_to_create[0]
        assert is_auto is True
        assert combined.account_id == 10
        assert combined.counter_account_id == 20
    
    def test_pair_transfers_mixed_types(self, service):
        """TRANSFER와 다른 타입 혼합 테스트"""
        items = [
            schemas.TransactionCreate(
                user_id=1,
                account_id=10,
                amount=50000.0,
                occurred_at=date(2025, 1, 10),
                type=TxnType.INCOME,
                currency="KRW",
                category_group_name="수입",
                category_name="월급"
            ),
            schemas.TransactionCreate(
                user_id=1,
                account_id=20,
                amount=-3000.0,
                occurred_at=date(2025, 1, 15),
                type=TxnType.TRANSFER,
                currency="KRW",
                transfer_flow="OUT",
                counter_account_id=30
            ),
            schemas.TransactionCreate(
                user_id=1,
                account_id=30,
                amount=3000.0,
                occurred_at=date(2025, 1, 15),
                type=TxnType.TRANSFER,
                currency="KRW",
                transfer_flow="IN"
            ),
        ]
        
        items_to_create, duplicates = service._pair_transfers(items)
        
        # INCOME 1개 + TRANSFER 페어 1개 = 2개
        assert len(items_to_create) == 2
        assert duplicates == 1
        
        # 첫 번째는 INCOME (auto_match=False)
        income_item, is_auto = items_to_create[0]
        assert income_item.type == TxnType.INCOME
        assert is_auto is False
        
        # 두 번째는 TRANSFER (auto_match=True)
        transfer_item, is_auto = items_to_create[1]
        assert transfer_item.type == TxnType.TRANSFER
        assert is_auto is True
    
    def test_filter_settlement_duplicates_no_duplicates(self, service, mock_db):
        """Settlement 중복 없을 때"""
        items = [
            (
                schemas.TransactionCreate(
                    user_id=1,
                    account_id=10,
                    amount=10000.0,
                    occurred_at=date(2025, 1, 20),
                    type=TxnType.INCOME,
                    currency="KRW",
                    category_group_name="수입",
                    category_name="월급"
                ),
                False
            )
        ]
        
        filtered, settlement_duplicates = service._filter_settlement_duplicates(items)
        
        assert len(filtered) == 1
        assert settlement_duplicates == 0
    
    def test_bulk_create_empty_items(self, service):
        """빈 항목 리스트"""
        created, metadata = service.bulk_create(user_id=1, items=[])
        
        assert len(created) == 0
        assert metadata["duplicate_transfers"] == 0
        assert metadata["settlement_duplicates"] == 0

