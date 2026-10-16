---
description: 변경 사항을 논리적 단위로 나눠 커밋해요 (계획을 먼저 보여주고 승인받음, push 는 선택)
argument-hint: "[push 하려면 'push']"
---
현재 워킹 트리의 변경을 **논리적 변경 단위**로 나눠 커밋합니다.
기준: "이 커밋을 revert 하면 하나의 의미 있는 변경이 통째로 빠진다".

1. 현황 파악: `git status`, `git diff HEAD --stat`, `git diff HEAD`, `git log --oneline -8` (메시지 스타일 확인)
2. 분류: 기능 추가/변경 · 리팩토링 · 버그 수정 · 테스트 · 마이그레이션 · 문서/설정.
   같은 논리 변경은 한 커밋으로 묶고, 의존 순서(엔티티 → DTO/리포지토리 → 마이그레이션)를 지킵니다.
   `git add -p` 는 대화형이라 쓸 수 없으니 파일 경계로 묶습니다.
3. **커밋 계획을 먼저 보여주고 승인받으세요.**
   ```
   커밋 1: refactor(payment): ...
     - a.java, b.java
   커밋 2: feat(post): ...
     - c.java
   ```
4. 승인되면 커밋별로 해당 파일만 `git add` 후 `git commit`.
   - 메시지: `<type>(<scope>): <한글 요약 50자 이내>` + 빈 줄 + "왜" 바꿨는지 1~3줄
   - type: feat | fix | refactor | test | chore | docs | perf
5. `$ARGUMENTS` 에 push 가 있을 때만 현재 브랜치를 push 합니다. 보호 브랜치 push 와 --force 는 하네스가 막아요.

주의: .env, application-local/prod, *.pem 이 스테이징되면 하네스가 커밋을 거부해요. 그때는 unstage 하고 이유를 알려주세요.
