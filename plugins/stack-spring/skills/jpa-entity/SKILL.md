---
name: jpa-entity
description: JPA 엔티티를 새로 만들거나 연관관계·상태 전이·소프트 삭제를 설계할 때 사용.
---
# JPA 엔티티 규칙
- `BaseEntity`(createdAt/updatedAt, JPA Auditing) 상속 — 프로젝트에 있으면
- `@Getter`, `@NoArgsConstructor(access = PROTECTED)`, setter 없음. 생성은 `private` 생성자 + `@Builder` 또는 `static create(...)`
- Enum 은 `@Enumerated(EnumType.STRING)`
- **상태 전이는 엔티티 메서드로** (`markApproved()`), 서비스에서 `setStatus()` 금지. 잘못된 전이는 엔티티 안에서 예외
- 연관관계: 기본 `LAZY`. 컬렉션 조회는 fetch join / `@EntityGraph` / batch size 중 하나를 의도적으로 선택하고 이유를 주석으로
- 소프트 삭제: `deletedAt` 필드 + 조회 쿼리에서 명시적 필터 (어디서 걸러지는지 Repository 이름에 드러나게)
- 원장(ledger)성 데이터는 append-only — 기존 행 수정 대신 상태 전이 레코드 추가
- 동시 차감(잔액·재고): 조건부 원자 UPDATE(`update ... set qty = qty - :n where id = :id and qty >= :n`) 또는 비관적 락 + 타임아웃
- 테이블명 snake_case 복수형, 엔티티 변경 시 반드시 마이그레이션 동반 (prod 는 ddl-auto=validate)
