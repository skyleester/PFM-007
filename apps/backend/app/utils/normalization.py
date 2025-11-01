"""
정규화 유틸리티 함수

계좌명, 토큰 등을 정규화하여 매칭 정확도를 높입니다.
"""

import re
import unicodedata


def normalize_account_token(value: str | None) -> str:
    """
    계좌명 토큰 정규화
    
    - 공백, 특수문자 제거
    - 소문자 변환
    - NFKC 정규화
    
    Args:
        value: 정규화할 문자열
    
    Returns:
        정규화된 문자열
    
    Example:
        >>> normalize_account_token("신한 은행-123")
        "신한은행123"
        >>> normalize_account_token("Hana Bank (Main)")
        "hanabankmain"
    """
    if not value:
        return ""
    
    # Unicode 정규화 (한글 자모 통일)
    normalized = unicodedata.normalize("NFKC", value)
    
    # 소문자 변환
    normalized = normalized.casefold()
    
    # 공백, 특수문자 제거 (알파벳, 숫자, 한글만 남김)
    normalized = re.sub(r"\W+", "", normalized, flags=re.UNICODE)
    
    return normalized


def normalize_account_ref(account_id: int | None, account_name: str | None) -> str:
    """
    계좌 참조 정규화
    
    account_id가 있으면 "id:{id}" 형식으로,
    없으면 정규화된 계좌명을 "name:{normalized_name}" 형식으로 반환
    
    Args:
        account_id: 계좌 ID
        account_name: 계좌명
    
    Returns:
        정규화된 계좌 참조 문자열
    
    Example:
        >>> normalize_account_ref(123, None)
        "id:123"
        >>> normalize_account_ref(None, "신한은행")
        "name:신한은행"
        >>> normalize_account_ref(None, None)
        ""
    """
    if account_id is not None:
        return f"id:{account_id}"
    
    if account_name:
        normalized = normalize_account_token(account_name)
        if normalized:
            return f"name:{normalized}"
    
    return ""
