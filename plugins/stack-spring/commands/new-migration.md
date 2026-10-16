---
description: 다음 버전 번호로 Flyway 마이그레이션 파일을 만들어요
argument-hint: "<스키마 변경 설명, 예: create notifications table>"
---
flyway-migration 스킬 규칙을 따릅니다.
1. `**/db/migration/` 에서 가장 큰 V 번호를 찾고 +1
2. `V{N}__{설명을 snake_case}.sql` 생성 — `$ARGUMENTS` 기반
3. 관련 엔티티가 있으면 엔티티와 컬럼/타입/제약이 일치하는지 대조해 표로 보여주기
4. 파괴적 변경이면 롤백 SQL 을 주석으로 함께 제안
