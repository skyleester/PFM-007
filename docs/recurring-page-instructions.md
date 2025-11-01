# Recurring Rules Page – Implementation Guide

## 목표
- 정기 거래(수입/지출/이체) 규칙을 조회, 생성, 수정, 비활성화할 수 있는 단일 페이지 뷰 제공.
- 각 규칙의 다음 발생 일정 및 미리보기 거래를 빠르게 확인할 수 있도록 요약 카드 + 상세 패널 구성.
- 캘린더/거래 모듈과 동일한 API 도우미(`apiGet`, `apiPost`, `apiPatch`, `apiDelete`) 활용으로 네트워크 일관성 유지.

## 정보 구조
1. **요약 헤더**
   - 전체 규칙 수, 활성 규칙, 다음 30일 예정 금액 합계 표시.
   - `GET /api/recurring-rules` 응답 필터링으로 계산.
2. **규칙 목록 테이블**
   - 열 구성: 이름, 유형(아이콘 포함), 계좌 → 상대 계좌, 주기, 금액, 상태, 다음 실행일.
   - 행 클릭 시 우측 상세 패널 또는 Drawer 열림.
   - 상단에 `유형`, `계좌`, `활성 여부` 필터와 검색바 배치.
3. **상세 패널**
   - 기본 정보(메모 포함), 마지막 생성일, 실패 로그(추후 확장 대비 placeholder).
   - "미리보기" 탭: `GET /api/recurring-rules/{id}/preview?start=...&end=...` 호출 결과를 타임라인으로 표시.
   - 액션 버튼: 활성/비활성 토글, 즉시 실행(향후), 수정, 삭제.
4. **규칙 생성/수정 폼**
   - 슬라이드 오버 또는 모달 선택.
   - 단계 구성: (1) 기본정보, (2) 스케줄 설정, (3) 금액/계좌, (4) 요약 확인.
   - 전송 시 `POST /api/recurring-rules` 또는 `PATCH /api/recurring-rules/{id}` 사용.
5. **발생 로그/히스토리 (후순위)**
   - 큐레이션된 최근 실행 내역을 보여줄 공간만 우선 마련.

## 컴포넌트 분할
- `app/recurring/page.tsx`: 데이터 훅 호출 및 페이지 뼈대.
- `app/recurring/components/RecurringSummary.tsx`: 헤더/카드.
- `app/recurring/components/RecurringTable.tsx`: 목록 테이블 + 필터.
- `app/recurring/components/RecurringDetailPanel.tsx`: 상세/미리보기 패널.
- `app/recurring/components/RecurringForm.tsx`: 생성/수정 폼.
- `lib/recurring/api.ts`: 전용 API 헬퍼 (목록/생성/수정/삭제/미리보기) 및 타입 정의.
- `lib/recurring/hooks.ts`: `useRecurringData`, `useRecurringPreview` 등 데이터 훅 추출.

## 데이터 흐름
1. 페이지 진입 시 `useRecurringData({ userId })`에서 목록 로딩.
2. 목록 선택 시 상세 패널이 열리고 `useRecurringPreview({ ruleId, range })` 호출.
3. 활성/비활성 토글은 즉시 optimistic update 후 API 호출, 실패 시 롤백 및 토스트 알림.
4. 폼 제출 성공 시 리스트 재조회(`refresh`) + 토스트 노출.

## 상태 관리
- React Query를 쓰지 않고 단순 훅/상태를 유지할 경우:
  - `useRecurringData` 내부에서 `useState` + `useEffect` + `refresh` 패턴을 사용해 캘린더와 동일한 인터페이스 유지.
  - 상세 패널 열림 상태는 `selectedRuleId`로 관리.
  - 필터 상태는 URL 쿼리스트링 동기화 준비(추후 Next 14 server search params 연동 고려).

## UI/UX 지침
- Tailwind 기반, 열/패널 레이아웃은 캘린더 페이지와 톤 앤 매너 맞추기.
- 금액은 `toLocaleString` + 색상(수입=emerald, 지출=rose, 이체=gray)으로 표현.
- 다음 실행일이 오늘/지난 경우 경고 배지 표시.
- 미리보기 리스트는 occurs_at 기준 오름차순 정렬, 각 항목은 거래 세부 항목과 동일한 스타일 재사용.

## 테스트
- Frontend: 최소한 목록 필터링/토글/폼 검증을 위한 React Testing Library 테스트 추가 (`__tests__/recurring.test.tsx`).
- Backend 이미 제공된 테스트 범위를 활용, 프론트에서 모킹으로 API 응답 시나리오 확인.

## 접근성
- 상세 패널, 폼, 토글 등 상호작용 요소에 `aria-*` 속성 제공.
- 키보드 포커스가 모달/슬라이드 오버 내에서 순환되도록 `focus-trap-react` 고려(이미 사용 중이면 재사용).

## 향후 확장 포인트
- 즉시 실행(Manual trigger) 버튼 구현 시 백엔드 엔드포인트 확인 후 추가.
- 반복 규칙 템플릿, 주기 미리보기 범위 선택, 실패 로그 저장 등은 별도 스프린트에서 다룸.

## 작업 전제
- 사용자 ID는 현재와 같이 하드코딩(1) 상태에서 시작하되, 후속 작업에서 사용자 세션 연동 대비 주석 남기기.
- API 오류 시 토스트/에러 상태 카드 표시.
- 기획 변경 여지를 위해 핵심 컴포넌트를 별도 디렉터리로 분리해 재사용성 확보.
