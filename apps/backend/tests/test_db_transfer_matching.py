"""
DB 기반 기존 이체 매칭 감지 테스트
"""

import pytest
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import TransactionBulkService
from app import schemas
from app.models import TxnType


class DummyTx:
    def __init__(self, user_id: int, amount: float, occurred_at: date, occurred_time: time | None, currency: str,
                 account_id: int | None = None, counter_account_id: int | None = None):
        self.user_id = user_id
        self.amount = amount
        self.occurred_at = occurred_at
        self.occurred_time = occurred_time
        self.currency = currency
        self.account_id = account_id
        self.counter_account_id = counter_account_id


class TestDbTransferMatching:
    @pytest.fixture
    def mock_db(self):
        return MagicMock()

    @pytest.fixture
    def service(self, mock_db):
        return TransactionBulkService(mock_db)

    def _setup_query_chain(self, mock_db, existing_list):
        # Build query().filter().filter()...all() chain
        mock_query = mock_db.query.return_value
        mock_filter1 = mock_query.filter.return_value
        mock_filter2 = mock_filter1.filter.return_value
        mock_filter3 = mock_filter2.filter.return_value
        mock_filter4 = mock_filter3.filter.return_value
        mock_filter4.all.return_value = existing_list

    def test_match_filters_out_leftover_transfer(self, service, mock_db):
        # 기존 DB에 반대 부호 동일 금액/시간의 TRANSFER가 있을 때
        existing = [
            DummyTx(
                user_id=1,
                amount=5000.0,
                occurred_at=date(2025, 1, 15),
                occurred_time=time(14, 30, 0),
                currency="KRW",
                account_id=20,
                counter_account_id=10,
            )
        ]
        self._setup_query_chain(mock_db, existing)

        items = [
            schemas.TransactionCreate(
                user_id=1,
                account_id=10,
                amount=-5000.0,
                occurred_at=date(2025, 1, 15),
                occurred_time=time(14, 30, 0),
                type=TxnType.TRANSFER,
                currency="KRW",
                transfer_flow="OUT",
                counter_account_name="카카오"
            )
        ]

        # 내부에서 _pair_transfers를 거치도록 bulk_create 경유
        created, meta = service.bulk_create(user_id=1, items=items, override=False)

        # 기존 DB 매칭으로 인해 생성이 스킵됨
        assert len(created) == 0
        assert meta["db_transfer_matches"] == 1

    def test_non_transfer_pass_through(self, service, mock_db, monkeypatch):
        # EXPENSE는 DB 매칭 로직의 대상이 아님
        self._setup_query_chain(mock_db, [])
        # routers.create_transaction를 스텁으로 대체하여 실제 DB 로직 우회
        from types import SimpleNamespace
        import app.routers as routers
        monkeypatch.setattr(routers, "create_transaction", lambda item, db, **kwargs: SimpleNamespace(id=123))
        items = [
            schemas.TransactionCreate(
                user_id=1,
                account_id=10,
                amount=-1200.0,
                occurred_at=date(2025, 1, 10),
                type=TxnType.EXPENSE,
                currency="KRW",
                category_group_name="지출",
                category_name="식비"
            )
        ]
        created, meta = service.bulk_create(user_id=1, items=items, override=False)
        assert len(created) == 1
        assert meta["db_transfer_matches"] == 0
