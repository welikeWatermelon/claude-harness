---
description: 프론트엔드 타입체크·린트·빌드를 한 번에 실행하고 요약해요
---
1. lockfile 로 패키지 매니저 판별 (pnpm-lock.yaml → pnpm, yarn.lock → yarn, bun.lock → bun, 그 외 npm)
2. package.json scripts 에 있는 것만 순서대로: typecheck(없으면 `tsc --noEmit`) → lint → build
3. 각 단계 통과/실패와 실패 원인(파일:라인) 요약. 고치지 말고 방향만 제안.
