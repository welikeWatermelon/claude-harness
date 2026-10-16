---
name: flyway-migration
description: DB 스키마를 바꾸거나 Flyway 마이그레이션 파일을 작성할 때 사용.
---
# Flyway 마이그레이션 규칙
1. 최신 버전 확인: `src/main/resources/db/migration/` 목록 → 다음 번호 사용 (`V{N}__{snake_case}.sql`, 언더스코어 두 개)
2. **기존 파일은 절대 수정하지 않음** — 하네스가 차단해요(checksum 불일치로 기동 실패). 고칠 게 있으면 새 버전으로.
3. PostgreSQL/MySQL 문법은 프로젝트 DB 에 맞춤. `IF NOT EXISTS` / `IF EXISTS` 가드
4. 컬럼 추가는 NULL 허용으로 먼저 → 데이터 채움(별도 버전) → NOT NULL 전환
5. FK 컬럼·자주 조회하는 컬럼에 인덱스. 대용량 테이블 인덱스는 PostgreSQL 이면 `CREATE INDEX CONCURRENTLY` 검토(트랜잭션 밖이어야 함)
6. 데이터 마이그레이션은 스키마 변경과 분리
7. 파괴적 변경(DROP/rename)은 PR 설명에 롤백 방법을 반드시 적음
8. 테스트 데이터 SQL 을 운영 init 경로에 두지 않음
