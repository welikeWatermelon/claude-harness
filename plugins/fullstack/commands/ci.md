---
description: (백엔드) PR 에서 API 계약 깨짐을 잡는 GitHub Actions 워크플로(oasdiff)를 추가해요
---
1. 미리보기:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" ci
   ```
2. 내용을 사용자에게 보여주고 동의하면 적용:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" ci --apply
   ```
3. 동작: PR 에서 `docs/api/openapi.json`(설정한 스냅샷 경로)이 바뀌면 base 브랜치 스냅샷과 비교해 **ERR 등급(프론트가 깨지는 변경)** 이 있으면 체크를 실패시키고, 전체 변경 요약을 Job Summary 에 남겨요. 도구는 `tufin/oasdiff` Docker 이미지라 러너에 설치할 것이 없어요.
4. 로컬에서도 같은 판정을 쓰려면 oasdiff 를 설치하세요(`go install github.com/oasdiff/oasdiff@latest` 또는 GitHub Releases 바이너리를 PATH 에). 설치돼 있으면 Stop 훅·`/fullstack:spec` 이 자동으로 oasdiff 결과를 써요. 끄려면 `.claude/harness.json` 에 `"fullstack": { "openapi": { "useOasdiff": false } }`.
5. 워크플로 파일을 커밋하고 PR 을 만드세요 (보호 브랜치 규칙 그대로).
