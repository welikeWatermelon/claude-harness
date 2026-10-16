---
name: transaction-and-events
description: 여러 도메인이 엮인 로직(크로스 도메인 호출, 순환 의존, 부수효과 전파, 비동기 처리)을 설계할 때 사용. 직접 호출 / Facade / 동기 이벤트 / 비동기 이벤트 중 무엇을 쓸지 판단한다.
---
# 크로스 도메인 패턴 선택 (MelonMe 17도메인에서 정리한 기준)

| 상황 | 패턴 |
|---|---|
| 결과가 필요한 조회·검증 | 상대 도메인 **Service 직접 호출** (가장 흔함) |
| 외부 행위 1개가 N개 도메인을 조합 | **Facade** (예: FollowFacade, MyPageFacade) |
| N개 도메인이 같은 부수효과를 공유 / 역방향 의존 때문에 빈 생성 순환이 생김 | **동기 도메인 이벤트** (`@EventListener`) |
| 무거운 작업, 트랜잭션 분리 필요 (알림·임베딩·분석) | **비동기 이벤트** (`@TransactionalEventListener(AFTER_COMMIT)` + `@Async` 전용 Executor) |

규칙
- 리스너는 이벤트를 **재발행하지 않는다** (연쇄 호출·무한 루프 방지)
- 커밋 전 데이터를 외부로 내보내면 롤백 시 불일치 → 외부 전파는 AFTER_COMMIT
- 순환 의존을 "이벤트가 순환 참조를 해결한다"고 표현하지 않는다. 정확히는 **역방향 의존을 없애 빈 생성 순환(BeanCurrentlyInCreationException)이 생기지 않게** 하는 것
- 런타임 호출 순환(무한 호출 → StackOverflowError)과 빈 생성 순환은 다른 문제
- 결정은 docs/decisions.md 또는 ADR 에 남긴다
