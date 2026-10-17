---
description: (백엔드) OpenAPI 명세를 지금 생성해 이전 계약과 비교하고, 프론트 영향을 정리해요
---
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" spec
```
결과 JSON 을 아래처럼 정리하세요.
- 깨지는 변경 / 호환 변경 개수
- 깨지는 변경마다: 대상, 내용, 프론트 사용처(`display:true` 는 화면 컴포넌트)
- 처리 원칙: [코드] 사용처는 프론트를 고치고, 화면에 보이던 값이 사라지거나 의미가 바뀌는 건 결정 대기 목록(.harness/pending-decisions.md)에 넣어 마지막에 개발자에게 질문
명세 생성이 실패하면 오류를 요약하고 /fullstack:setup 의 springdoc 설정을 점검하자고 하세요.
