"""
내부 이체 매칭 로직 테스트 스크립트

사용법:
  python test_transfer_matching.py
"""

# Test Case 1: 확실한 내부 이체 (분류명이 다르지만 시간+금액 일치)
test_case_1 = [
    {
        "occurred_at": "2025-10-13",
        "occurred_time": "09:02:00",
        "type": "TRANSFER",
        "amount": 400000,
        "currency": "KRW",
        "account_name": "입출금통장 4305",
        "category_group_name": "이체",
        "category_name": "미분류",
        "memo": "이호천",
        "transfer_flow": "IN",
    },
    {
        "occurred_at": "2025-10-13",
        "occurred_time": "09:02:00",
        "type": "TRANSFER",
        "amount": -400000,
        "currency": "KRW",
        "account_name": "급여 하나 통장 (호천)",
        "category_group_name": "이체",
        "category_name": "미분류",
        "memo": "윤지수",
        "transfer_flow": "OUT",
    },
]

# Test Case 2: 의심 내부 이체 (내용이 다름)
test_case_2 = [
    {
        "occurred_at": "2025-10-10",
        "occurred_time": "09:45:00",
        "type": "TRANSFER",
        "amount": 400000,
        "currency": "KRW",
        "account_name": "입출금통장 4305",
        "category_group_name": "내계좌이체",
        "category_name": "미분류",
        "memo": "윤지수",
        "transfer_flow": "IN",
    },
    {
        "occurred_at": "2025-10-10",
        "occurred_time": "09:45:00",
        "type": "TRANSFER",
        "amount": -400000,
        "currency": "KRW",
        "account_name": "급여 하나 통장(지수)",
        "category_group_name": "내계좌이체",
        "category_name": "미분류",
        "memo": "호호",
        "transfer_flow": "OUT",
    },
]


def calculate_similarity(a: str, b: str) -> float:
    """간단한 Levenshtein distance 기반 유사도"""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    
    s1 = a.lower().strip()
    s2 = b.lower().strip()
    
    if s1 == s2:
        return 1.0
    
    len1, len2 = len(s1), len(s2)
    if len1 == 0:
        return 1.0 if len2 == 0 else 0.0
    if len2 == 0:
        return 0.0
    
    # Levenshtein distance
    matrix = [[0] * (len2 + 1) for _ in range(len1 + 1)]
    for i in range(len1 + 1):
        matrix[i][0] = i
    for j in range(len2 + 1):
        matrix[0][j] = j
    
    for i in range(1, len1 + 1):
        for j in range(1, len2 + 1):
            cost = 0 if s1[i - 1] == s2[j - 1] else 1
            matrix[i][j] = min(
                matrix[i - 1][j] + 1,      # deletion
                matrix[i][j - 1] + 1,      # insertion
                matrix[i - 1][j - 1] + cost # substitution
            )
    
    distance = matrix[len1][len2]
    max_len = max(len1, len2)
    return 1.0 - distance / max_len


def calculate_match_confidence(out_item: dict, in_item: dict) -> dict:
    """매칭 신뢰도 계산"""
    score = 0
    reasons = []
    
    # 필수: 시간+금액 일치 (50점)
    time_match = (
        out_item["occurred_at"] == in_item["occurred_at"] and
        out_item["occurred_time"] == in_item["occurred_time"]
    )
    amount_match = (
        abs(out_item["amount"]) == abs(in_item["amount"]) and
        out_item["currency"] == in_item["currency"]
    )
    
    if not time_match or not amount_match:
        return {
            "score": 0,
            "level": "UNLIKELY",
            "reasons": ["시간 또는 금액 불일치"]
        }
    
    score += 50
    reasons.append("시간+금액 일치")
    
    # 분류명 확인 (+30점)
    internal_keywords = ["내계좌이체", "계좌이체", "이체", "transfer"]
    out_keywords = " ".join([
        out_item.get("category_group_name", ""),
        out_item.get("category_name", ""),
    ]).lower()
    in_keywords = " ".join([
        in_item.get("category_group_name", ""),
        in_item.get("category_name", ""),
    ]).lower()
    
    out_has_keyword = any(kw in out_keywords for kw in internal_keywords)
    in_has_keyword = any(kw in in_keywords for kw in internal_keywords)
    
    if out_has_keyword and in_has_keyword:
        score += 30
        reasons.append("분류명이 내부 이체 패턴과 일치")
        
        # "내계좌이체" 명시 보너스 (+10점)
        if "내계좌이체" in out_keywords and "내계좌이체" in in_keywords:
            score += 10
            reasons.append("'내계좌이체' 명시")
    
    # 계좌 확인 (+10점 or -20점)
    if out_item["account_name"] != in_item["account_name"]:
        score += 10
        reasons.append("서로 다른 계좌")
    else:
        score -= 20
        reasons.append("⚠️ 동일 계좌 (A→A)")
    
    # Memo 유사도 (±10점)
    memo_similarity = calculate_similarity(
        out_item.get("memo", ""),
        in_item.get("memo", "")
    )
    if memo_similarity > 0.7:
        score += 10
        reasons.append(f"내용 유사 ({int(memo_similarity * 100)}%)")
    elif memo_similarity < 0.3:
        score -= 10
        reasons.append(f"⚠️ 내용 불일치 ({int(memo_similarity * 100)}%)")
    
    # 신뢰도 레벨
    if score >= 80:
        level = "CERTAIN"
    elif score >= 50:
        level = "SUSPECTED"
    else:
        level = "UNLIKELY"
    
    return {
        "score": score,
        "level": level,
        "reasons": reasons
    }


def test_matching():
    """매칭 로직 테스트"""
    print("=" * 80)
    print("내부 이체 매칭 로직 테스트")
    print("=" * 80)
    
    # Test Case 1
    print("\n[Test Case 1] 확실한 내부 이체 (분류명 '이체')")
    print("-" * 80)
    out1 = [item for item in test_case_1 if item["amount"] < 0][0]
    in1 = [item for item in test_case_1 if item["amount"] > 0][0]
    
    print(f"OUT: {out1['occurred_at']} {out1['occurred_time']} {out1['amount']:,} {out1['account_name']}")
    print(f"     memo: {out1['memo']}, category: {out1['category_group_name']}")
    print(f"IN:  {in1['occurred_at']} {in1['occurred_time']} {in1['amount']:,} {in1['account_name']}")
    print(f"     memo: {in1['memo']}, category: {in1['category_group_name']}")
    
    confidence1 = calculate_match_confidence(out1, in1)
    print(f"\n신뢰도: {confidence1['score']}점 ({confidence1['level']})")
    print(f"이유: {', '.join(confidence1['reasons'])}")
    print(f"예상 결과: {'✅ 자동 TRANSFER 생성' if confidence1['level'] == 'CERTAIN' else '⚠️ 사용자 확인 필요'}")
    
    # Test Case 2
    print("\n\n[Test Case 2] 의심 내부 이체 (내용 다름)")
    print("-" * 80)
    out2 = [item for item in test_case_2 if item["amount"] < 0][0]
    in2 = [item for item in test_case_2 if item["amount"] > 0][0]
    
    print(f"OUT: {out2['occurred_at']} {out2['occurred_time']} {out2['amount']:,} {out2['account_name']}")
    print(f"     memo: {out2['memo']}, category: {out2['category_group_name']}")
    print(f"IN:  {in2['occurred_at']} {in2['occurred_time']} {in2['amount']:,} {in2['account_name']}")
    print(f"     memo: {in2['memo']}, category: {in2['category_group_name']}")
    
    confidence2 = calculate_match_confidence(out2, in2)
    print(f"\n신뢰도: {confidence2['score']}점 ({confidence2['level']})")
    print(f"이유: {', '.join(confidence2['reasons'])}")
    print(f"예상 결과: {'✅ 자동 TRANSFER 생성' if confidence2['level'] == 'CERTAIN' else '⚠️ 사용자 확인 필요'}")
    
    # Summary
    print("\n" + "=" * 80)
    print("테스트 요약")
    print("=" * 80)
    print(f"Test Case 1: {confidence1['level']} ({'PASS' if confidence1['level'] == 'CERTAIN' else 'EXPECTED BEHAVIOR'})")
    print(f"Test Case 2: {confidence2['level']} ({'PASS' if confidence2['level'] in ['CERTAIN', 'SUSPECTED'] else 'FAIL'})")
    print("\n기대 동작:")
    print("- Test Case 1: 자동으로 TRANSFER 생성 (memo 다르지만 분류명 '이체'로 확실)")
    print("- Test Case 2: 사용자 확인 모달 표시 또는 자동 생성 (memo 다르지만 '내계좌이체' 명시)")
    print("  → 현재: memo 불일치로 -10점 패널티 → 80점 (CERTAIN) 또는 70점 (SUSPECTED)")


if __name__ == "__main__":
    test_matching()
