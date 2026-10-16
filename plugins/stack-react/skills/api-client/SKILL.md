---
name: api-client
description: 프론트엔드에서 백엔드 API 를 호출하는 코드를 만들거나, 백엔드 응답 포맷·에러 코드와 타입을 맞출 때 사용.
---
# API 클라이언트 규칙
- 백엔드 공통 응답 래퍼를 타입으로 정의: 예) `type ApiResponse<T> = { success: true; data: T } | { success: false; code: string; message: string }`
- 실제 형식은 백엔드 `ApiResponse` / `ErrorResponse` 클래스나 API 명세(docs/api)를 열어 확인하고 맞춤 — 추측 금지
- 에러는 HTTP 상태가 아니라 백엔드 ErrorCode 로 분기 (예: `PAYMENT_IN_PROGRESS` 409 → 재시도 안내)
- 인증: 액세스 토큰 만료 시 refresh 1회 → 실패하면 로그인 이동. 동시에 여러 요청이 만료되면 refresh 를 한 번만
- 페이지네이션 필드 이름(items/pageNumber/hasNext 등)을 백엔드와 동일하게
- 백엔드 API 응답이 바뀌는 PR 이면 docs/FRONTEND_BREAKING_CHANGES.md 같은 변경 기록을 확인
