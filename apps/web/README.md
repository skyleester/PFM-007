# PFM Web (Next.js)

Next.js 15 App Router + Tailwind CSS 스켈레톤.

## 시작하기

```bash
cd apps/web
npm install
npm run dev
```

- 백엔드 기본 URL: http://127.0.0.1:8000
- 변경은 `.env.local`에서 `NEXT_PUBLIC_BACKEND_URL`로 설정

```env
# .env.local (예시)
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
# 공휴일 API (공공데이터포털) 서비스 키
KR_HOLIDAYS_SERVICE_KEY=발급받은_서비스키
```

> `holidays-kr` 라이브러리는 공공데이터포털의 `SpcdeInfoService`를 사용합니다. 서비스 키가 없으면 공휴일 정보는 표시되지 않습니다.

## 페이지
- `/` 홈
- `/accounts` 계정 목록 (user_id=1 고정 샘플)
- `/transactions` 트랜잭션 목록 (user_id=1 고정 샘플) — 현재 Next 15 업그레이드로 임시 플레이스홀더 화면입니다.

필요시 Server Actions나 클라이언트 컴포넌트로 확장하세요.
