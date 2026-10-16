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
