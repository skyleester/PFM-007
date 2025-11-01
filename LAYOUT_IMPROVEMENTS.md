# PC UI 레이아웃 개선 가이드

## 적용된 변경사항

### 1. 기본 레이아웃 확장 ✅
- **파일**: `app/layout.tsx`, `components/TopNav.tsx`
- **변경**: 컨테이너 최대 너비를 1920px로 확장하고 반응형 패딩 개선
- **효과**: 큰 화면에서 더 많은 정보를 한눈에 볼 수 있음

## 추가 개선 제안

### 2. 페이지별 2열 레이아웃 적용

#### Transactions 페이지
```tsx
<div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr] xl:grid-cols-[380px_1fr]">
  {/* 왼쪽: 필터 & 폼 */}
  <aside className="space-y-6">
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold">필터</h2>
      {/* 필터 컴포넌트 */}
    </div>
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold">새 거래 추가</h2>
      {/* 폼 컴포넌트 */}
    </div>
  </aside>
  
  {/* 오른쪽: 테이블 */}
  <main className="min-h-screen">
    <div className="rounded-lg border bg-white shadow-sm">
      {/* 테이블 컴포넌트 */}
    </div>
  </main>
</div>
```

**장점**:
- ✅ 필터와 테이블을 동시에 볼 수 있음
- ✅ 테이블이 더 넓은 공간 차지
- ✅ 스크롤 양 감소

#### Statistics 페이지
```tsx
<div className="space-y-6">
  {/* 상단: KPI 카드 그리드 */}
  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
    {/* KPI 카드들 */}
  </div>
  
  {/* 중단: 차트 그리드 */}
  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
    {/* 차트 카드들 */}
  </div>
  
  {/* 하단: 상세 테이블 */}
  <div className="rounded-lg border bg-white p-6 shadow-sm">
    {/* 테이블 */}
  </div>
</div>
```

**장점**:
- ✅ 대시보드 스타일로 정보 밀도 향상
- ✅ 여러 차트를 한눈에 비교 가능
- ✅ 스크롤 없이 주요 지표 확인

#### Accounts 페이지
```tsx
<div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
  {/* 왼쪽: 계좌 목록 */}
  <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {/* 계좌 카드들 */}
    </div>
  </div>
  
  {/* 오른쪽: 상세/폼 */}
  <aside className="space-y-4 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]">
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      {/* 선택된 계좌 상세 또는 추가 폼 */}
    </div>
  </aside>
</div>
```

#### Recurring 페이지
```tsx
<div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px_1fr]">
  {/* 왼쪽: 규칙 목록 */}
  <aside className="space-y-4">
    {/* 규칙 카드들 (스크롤) */}
  </aside>
  
  {/* 오른쪽: 선택된 규칙 상세 */}
  <main>
    {/* 탭: 미리보기 | 과거 발생 | 후보 트랜잭션 */}
  </main>
</div>
```

### 3. 공통 컴포넌트 패턴

#### PageHeader 컴포넌트
```tsx
<div className="mb-6 flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
    {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
  </div>
  <div className="flex gap-2">
    {actions}
  </div>
</div>
```

#### Card 컴포넌트
```tsx
<div className="rounded-lg border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
  {children}
</div>
```

#### SidePanel 컴포넌트 (고정 사이드바)
```tsx
<aside className="sticky top-20 h-[calc(100vh-6rem)] overflow-y-auto">
  {/* 스크롤 가능한 사이드 콘텐츠 */}
</aside>
```

### 4. 반응형 우선순위

#### Desktop (lg: 1024px+)
- 2열 레이아웃 활성화
- 필터/폼 사이드 패널 표시
- 테이블 너비 확장

#### Tablet (md: 768px)
- 1열 레이아웃
- 접을 수 있는 필터
- 카드 그리드 2열

#### Mobile (sm: 640px-)
- 1열 레이아웃
- 모든 섹션 세로 스택
- 터치 친화적 컨트롤

### 5. 색상 & 시각적 계층

#### 배경
- `bg-gray-50`: 페이지 배경
- `bg-white`: 카드 배경
- `bg-gray-100`: 보조 영역

#### 경계
- `border-gray-200`: 기본 경계선
- `border-gray-300`: 강조 경계선

#### 그림자
- `shadow-sm`: 기본 카드
- `shadow-md`: 호버/활성 카드
- `shadow-lg`: 모달/드롭다운

### 6. 빠른 적용 체크리스트

각 페이지별로 다음 순서로 작업:

1. ✅ **레이아웃 확장** (완료)
2. ⬜ **페이지를 섹션으로 분할**
   - 필터/폼 영역
   - 메인 콘텐츠 영역
   - 상세/액션 영역
3. ⬜ **2열 그리드 적용** (lg 이상)
4. ⬜ **카드 컴포넌트로 래핑**
5. ⬜ **sticky 사이드바 적용** (필요시)
6. ⬜ **반응형 테스트**

### 우선순위 페이지

1. **Transactions** ⭐⭐⭐ (가장 자주 사용)
2. **Statistics** ⭐⭐⭐ (정보 밀도 중요)
3. **Recurring** ⭐⭐ (복잡한 UI)
4. **Accounts** ⭐⭐ (카드 레이아웃 적합)
5. **Calendar** ⭐ (달력 특성상 전체 너비 필요)

## 다음 단계

원하시는 페이지를 선택하시면 구체적인 코드로 적용해드리겠습니다:

1. Transactions 페이지 2열 레이아웃
2. Statistics 페이지 대시보드 스타일
3. Recurring 페이지 마스터-디테일 레이아웃
4. 전체 페이지 일괄 적용

어떤 페이지부터 시작할까요?
