---
description: 다른 도메인 작업을 병렬로 하기 위한 git worktree 를 만들어요 (IntelliJ 창 분리용)
argument-hint: "<브랜치명 예: feature/payment-refund>"
---
1. 현재 레포 루트와 폴더명을 확인합니다 (`git rev-parse --show-toplevel`).
2. 아래 명령을 **보여주고 승인받은 뒤** 실행합니다.
   ```
   git worktree add ../<레포명>-<브랜치 마지막 부분> -b $ARGUMENTS
   ```
   브랜치가 이미 있으면 `-b` 없이 실행합니다.
3. 안내:
   - IntelliJ 에서 새 폴더를 **별도 창**으로 열기 (worktree 하나 = IntelliJ 창 하나)
   - 그 폴더에서 Claude Code 를 따로 실행하면 서로 파일 충돌 없이 병렬 작업
   - `.harness/` 상태는 worktree 마다 따로 생겨요
   - 끝나면 `git worktree remove ../<폴더>` (머지 후)
