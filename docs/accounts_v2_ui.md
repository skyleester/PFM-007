# AccountV2 관리 UI (/(settings)/accounts-v2)

본 문서는 AccountV2 관리 페이지의 UI 구조, API 연동 방식, 상태 흐름을 요약합니다.

## 개요
- 경로: `/accounts-v2`
- 목적: AccountV2 트리 조회/선택/재배치, 계정 기본 필드 수정, 메타데이터(종류별) 편집/검증/저장
- 의존: FastAPI v2 엔드포인트
  - GET `/api/v2/accounts/tree`
  - POST `/api/v2/accounts/init-default`
  - POST `/api/v2/accounts/validate`
  - POST `/api/v2/accounts`
  - PATCH `/api/v2/accounts/{id}`
  - DELETE `/api/v2/accounts/{id}`

## UI 구조
- 좌측 사이드바
  - 계정 트리: 드래그 앤 드롭으로 부모 변경 지원
    - 루트 드롭영역을 통해 parent_id=null 이동 가능
  - "계정 추가" 폼: 이름/유형/프로바이더로 간단 생성 (선택 노드 하위로 생성 가능)
- 우측 메인
  - 계정 상세 헤더: 유형 배지, id, 이름/프로바이더 표시, 삭제 버튼
  - 기본 필드 폼: 이름, 유형, 프로바이더, 상위(parent), 활성화
  - 메타데이터 영역
    - 스마트 폼: 종류별 필드
      - CARD: billing_cutoff_day, payment_day, auto_deduct
      - 공통: color, external_ids
    - 고급: 원본 JSON 에디터 (스마트 폼과 양방향 동기화)
    - 검증 버튼 → `/validate` 호출로 정규화 결과 반영
    - 저장 버튼 → PATCH로 기본 필드 + extra_metadata 동시 저장
  - 토스트: 검증/저장/재배치 성공·실패를 우상단 토스트로 알림

## 상태 흐름
1. 진입 시 GET `/tree` 로드 → 트리 렌더링
2. 노드 선택 → 상세/폼 상태 초기화 (기본 필드 + metadata)
3. 메타데이터 수정
   - 스마트 폼 수정 → JSON 동기화
   - JSON 수정 → 파싱 성공 시 스마트 폼 동기화
4. 검증
   - POST `/validate`(type, metadata)
   - 정상: normalized를 상태에 반영(+토스트), 에러: 메시지 표시(+토스트)
5. 저장
   - PATCH `/{id}`: { name, type, provider, parent_id, is_active, extra_metadata }
   - 성공 시 트리 재조회(+토스트)
6. 재배치(드래그)
   - Node → Node: draggedId를 target.id로 parent 변경
   - 루트 드롭영역: parent_id=null
   - 성공 시 트리 재조회(+토스트)

## 컴포넌트
- `components/accounts-v2/AccountTree.tsx`
  - HTML5 Drag & Drop으로 재배치 지원
  - Props: `nodes`, `selectedId`, `onSelect`, `collapsed`, `onToggle`, `onReparent(draggedId, newParentId|null)`
- `components/accounts-v2/MetadataForm.tsx`
  - Props: `kind`, `value`, `onChange`
  - 공통/종류별 입력 필드 제공
- 페이지: `app/(settings)/accounts-v2/page.tsx`
  - 위 컴포넌트를 조합하여 전체 UX 구현

## 에지케이스
- 순환(parent를 자신의 자식으로 설정): 드롭/셀렉트 처리 시 후손 노드는 Parent 후보에서 제외
- 검증 실패: 토스트/결과 영역에 에러 표시, 저장 차단하지 않지만 권장되지 않음
- API 실패: 토스트로 사용자 알림

## 확장 아이디어
- 메타데이터 스키마 기반의 자동 폼 생성(백엔드에서 JSON Schema 제공)
- 다중 선택/일괄 재배치
- 이름 검색/필터

