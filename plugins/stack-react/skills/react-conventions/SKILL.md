---
name: react-conventions
description: React 컴포넌트·훅·페이지를 새로 만들거나 구조를 바꿀 때 사용. 프로젝트 CLAUDE.md 가 우선.
---
# React 기본 컨벤션 (프로젝트 규칙이 있으면 그것이 우선)
- 컴포넌트는 함수형 + TypeScript props 타입. 파일 하나에 export 컴포넌트 하나
- 서버 상태는 쿼리 라이브러리(TanStack Query 등) 사용 중이면 그쪽으로, 직접 fetch+useState 금지
- 데이터 가져오기는 `api/` 레이어 함수로 모으고 컴포넌트는 호출만 (api-client 스킬)
- 로딩·에러·빈 상태를 항상 렌더링 분기로 둔다
- 파생 값은 state 가 아니라 계산(필요하면 useMemo)
- 이펙트에서 구독·타이머·요청은 cleanup / AbortController
- 스타일은 프로젝트가 쓰는 방식(Tailwind/CSS Modules/styled) 하나만
- 새 컴포넌트를 만들기 전에 비슷한 기존 컴포넌트를 먼저 찾아 재사용

## 하네스가 자동으로 거는 규칙 (stack-react)
| ID | 내용 | 기본 |
|---|---|---|
| R1 | 수정한 파일에 `eslint --fix` → 남은 오류는 바로 고치기 | 경고 |
| R2 | eslint·tsconfig·prettier 설정 수정은 사용자 확인 | 확인 |
| R3 | 이유 없는 `eslint-disable` / `@ts-ignore` / `@ts-nocheck` | 차단 |
| R4 | 새 `any` | 경고 |
| R5 | 끝낼 때 바뀐 파일에 남은 `console.log` | 경고 |
| R6 | `localhost`·내부 IP·`/api/` 절대 주소 하드코딩 | 경고 |
| R7 | `VITE_`/`NEXT_PUBLIC_`/`REACT_APP_` 이름에 SECRET·PASSWORD·DB 등 | 차단 |
| R8 | components/pages 에서 `fetch`·`axios` 직접 호출 | 경고 |
| R9 | Next `'use client'` 파일의 서버 전용 import·비공개 `process.env` | 차단 |
| R10 | floating promise, exhaustive-deps 무시 (리뷰어가 확인) | 권고 |
| R11 | 끝낼 때 바뀐 파일과 짝인 vitest/jest 테스트 실행 | 차단 |

강도는 `.claude/harness.json` 의 `"rules": { "R4": "off" }` 처럼 바꿀 수 있어요. 억제가 꼭 필요하면 이유를 붙이세요:
```ts
// eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회만 로드
// @ts-expect-error: 라이브러리 타입 정의 누락 (#123)
```
R10 을 린트로 강제하려면 eslint 설정에 `@typescript-eslint/no-floating-promises: "error"`, `react-hooks/exhaustive-deps: "error"` 를 두세요 (설정 수정은 사람이 직접).
