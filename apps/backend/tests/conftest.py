from __future__ import annotations

import os
import tempfile
from typing import Generator, Any

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base, get_db
from app.main import app
from app import models


@pytest.fixture(scope="session")
def test_db_url() -> Generator[str, Any, Any]:
    # 사용자 환경을 건드리지 않도록 임시 파일 SQLite 사용
    fd, path = tempfile.mkstemp(prefix="pfm_test_", suffix=".sqlite3")
    os.close(fd)
    url = f"sqlite:///{path}"
    yield url
    try:
        os.remove(path)
    except OSError:
        pass


@pytest.fixture(scope="session")
def engine(test_db_url: str):
    eng = create_engine(test_db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    return eng


@pytest.fixture(scope="function")
def db_session(engine) -> Generator[Any, Any, Any]:
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = TestingSessionLocal()
    # 매 테스트마다 깨끗한 상태를 보장하기 위해 전체 초기화/시드
    # 간단 시드: demo user(1), I/E/T 미분류 그룹/카테고리(코드 00)
    user = models.User(email="demo@example.com", is_active=True)
    session.add(user)
    session.flush()
    session.add(models.UserProfile(user_id=user.id, display_name="Demo", base_currency="KRW"))
    for t in ("I", "E", "T"):
        g = models.CategoryGroup(type=t, code_gg=0, name="미분류")
        session.add(g)
        session.flush()
        session.add(models.Category(group_id=g.id, code_cc=0, name="미분류", full_code=f"{t}0000"))
    session.commit()

    try:
        yield session
    finally:
        session.close()
        # 테이블 데이터 정리 (SQLAlchemy 2.x 스타일)
        from sqlalchemy import text
        with engine.begin() as conn:
            if engine.dialect.name == "sqlite":
                conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            for tbl in Base.metadata.tables.values():
                conn.execute(tbl.delete())
            if engine.dialect.name == "sqlite":
                conn.exec_driver_sql("PRAGMA foreign_keys=ON")


@pytest.fixture(autouse=True)
def override_dependency(db_session):
    # FastAPI DI override
    def _get_db_override():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _get_db_override
    yield
    app.dependency_overrides.clear()


@pytest.fixture()
def client(db_session):
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c
