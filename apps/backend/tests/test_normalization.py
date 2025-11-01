"""
정규화 유틸리티 테스트
"""

import pytest
from app.utils.normalization import normalize_account_token, normalize_account_ref


class TestNormalizeAccountToken:
    def test_basic_normalization(self):
        """기본 정규화"""
        assert normalize_account_token("신한은행") == "신한은행"
        assert normalize_account_token("Hana Bank") == "hanabank"
    
    def test_remove_special_chars(self):
        """특수문자 제거"""
        assert normalize_account_token("신한 은행-123") == "신한은행123"
        assert normalize_account_token("Hana Bank (Main)") == "hanabankmain"
        assert normalize_account_token("계좌#1234") == "계좌1234"
    
    def test_unicode_normalization(self):
        """유니코드 정규화 (NFKC)"""
        # 전각 숫자 → 반각 숫자
        assert normalize_account_token("계좌１２３") == "계좌123"
    
    def test_case_insensitive(self):
        """대소문자 무시"""
        assert normalize_account_token("HaNa BaNk") == "hanabank"
        assert normalize_account_token("SHINHAN") == "shinhan"
    
    def test_empty_string(self):
        """빈 문자열 처리"""
        assert normalize_account_token("") == ""
        assert normalize_account_token(None) == ""
    
    def test_whitespace_only(self):
        """공백만 있는 경우"""
        assert normalize_account_token("   ") == ""
        assert normalize_account_token("\n\t") == ""


class TestNormalizeAccountRef:
    def test_with_account_id(self):
        """account_id 우선"""
        assert normalize_account_ref(123, "신한은행") == "id:123"
        assert normalize_account_ref(456, None) == "id:456"
    
    def test_with_account_name_only(self):
        """account_name만 있는 경우"""
        assert normalize_account_ref(None, "신한은행") == "name:신한은행"
        assert normalize_account_ref(None, "Hana Bank") == "name:hanabank"
    
    def test_with_neither(self):
        """둘 다 없는 경우"""
        assert normalize_account_ref(None, None) == ""
        assert normalize_account_ref(None, "") == ""
    
    def test_account_name_normalization(self):
        """계좌명 정규화 적용 확인"""
        assert normalize_account_ref(None, "신한 은행-123") == "name:신한은행123"
        assert normalize_account_ref(None, "Hana Bank (Main)") == "name:hanabankmain"
