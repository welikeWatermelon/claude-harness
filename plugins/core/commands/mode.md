---
description: 하네스 작업 모드를 바꿔요 — standard | strict | night | readonly | ops
argument-hint: "<standard|strict|night|readonly|ops>"
---
모드 전환은 이 메시지가 제출될 때 하네스 훅(UserPromptSubmit)이 이미 처리했어요. 모델은 모드 파일을 직접 고칠 수 없습니다.

아래 명령으로 현재 상태를 확인하고, 바뀐 모드와 그 모드에서 막히는 것을 2~3줄로 알려주세요.
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" status
```

모드 설명:
- **standard**: 기본. 보호 브랜치·위험 명령·시크릿만 막고, 모호한 요청엔 Plan 먼저 안내
- **strict**: 본인에게 계획 게이트를 켜요. 계획 승인 전에는 파일 수정 차단, 승인 후엔 계획의 "## 변경 파일" 목록만 계속 수정 가능
  (팀원에게 거는 계획 게이트는 모드가 아니라 `.claude/harness.json` 의 `planGate.requiredFor` 로 정해요)
- **night**: 무인 실행. 파일 편집만 허용, 빌드·테스트·서버 접속·git 쓰기·설치 차단 → 실행이 필요한 검증은 워크로그에 남김
- **readonly**: 분석 전용. 수정·변경성 명령 전부 차단
- **ops**: 운영 작업. 원격 명령도 허용하되 전부 확인받고 기록 (ops 플러그인과 함께 사용)
