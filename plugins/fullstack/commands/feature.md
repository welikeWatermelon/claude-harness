---
description: 기능 하나를 백엔드 API부터 프론트 화면까지 끝까지 구현해요 (레포 2개)
argument-hint: "<기능 설명>"
---
`$ARGUMENTS` 기능을 백엔드 → 계약 → 프론트 순서로 진행합니다. 두 레포 모두 작업 브랜치에서 해요 (하네스가 보호 브랜치를 막아요).

0. **계획 단계 (이때만 질문 가능)**: 엔드포인트(메서드·경로), 요청/응답 필드, 에러 코드, 화면 목록, 완료 조건(백엔드 테스트 + 프론트 타입체크)을 제시하고 승인받기. 정하지 못한 부분은 결정 대기 목록으로.
1. **백엔드**: Controller·Service·DTO·테스트 (stack-spring 규칙). springdoc 어노테이션(@Operation, @Schema)으로 필드 설명 추가.
2. **계약**: `/fullstack:spec` 으로 명세 생성·스냅샷 갱신. 깨지는 변경이 있으면 위 원칙대로 처리.
3. **프론트**: `/fullstack:api-sync` → API 함수(api-client 스킬) → 화면(react-conventions 스킬) → 타입체크.
4. **마무리**: api-contract-reviewer 에이전트로 양쪽 대조, 두 레포 각각 `/workflow:commit` 제안. 결정 대기 항목이 있으면 마지막에 한 번에 질문.
