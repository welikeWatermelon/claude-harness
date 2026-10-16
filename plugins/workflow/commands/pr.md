---
description: 현재 브랜치 변경으로 PR 제목·본문을 작성해요 (gh 가 있으면 PR 생성까지 제안)
argument-hint: "[base 브랜치, 기본 main] [관련 이슈]"
---
1. base 브랜치: `$ARGUMENTS` 첫 단어가 브랜치명이면 그것, 아니면 기본 브랜치(main/master).
2. `git log --oneline <base>..HEAD`, `git diff <base>...HEAD --stat`, 필요한 부분은 `git diff <base>...HEAD -- <파일>` 로 읽습니다.
3. 아래 형식으로 작성합니다. 코드에서 확인한 사실만 씁니다.
   ```markdown
   ## 무엇을 바꿨나
   - (사용자 관점 변화 위주 3~5줄)
   ## 왜
   - (문제/요구사항, 관련 이슈)
   ## 어떻게 확인했나
   - 실행한 테스트/명령과 결과 (실제 실행한 것만. 안 했으면 "미실행"으로 적기)
   ## 리뷰 포인트
   - 트랜잭션 경계, 마이그레이션, 호환성 깨짐(API 응답 변경) 등 리뷰어가 봐야 할 곳
   ## 롤백
   - revert 로 충분한지, 마이그레이션 되돌리기가 필요한지
   ```
4. `gh` 가 설치돼 있으면 `gh pr create --base <base> --title ... --body-file -` 실행을 **제안만** 하고, 사용자가 승인하면 실행합니다.
