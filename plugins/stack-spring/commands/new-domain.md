---
description: 새 도메인 모듈(Controller/Service/Repository/Entity/DTO + 테스트 + 마이그레이션)을 프로젝트 컨벤션대로 만들어요
argument-hint: "<도메인 이름>"
---
1. 먼저 읽기: 프로젝트 CLAUDE.md, docs/architecture/CONVENTIONS.md (있으면), **기존 도메인 하나를 골라 패키지 구조와 클래스 모양을 그대로 확인**.
2. 계획 제시 (승인 전 생성 금지): 만들 파일 목록, 엔티티 필드, 엔드포인트 목록, ErrorCode 추가분, SecurityConfig 변경 여부, 마이그레이션 내용.
3. 승인 후 생성 — spring-api-conventions, jpa-entity, flyway-migration 스킬 적용.
4. 서비스 테스트(정상/권한 없음/없음) 를 test-writer 규칙으로 함께 작성.
5. 도메인 CLAUDE.md(담당 범위, 핵심 규칙, 교차 도메인, 주의)도 만들지 물어보세요.
