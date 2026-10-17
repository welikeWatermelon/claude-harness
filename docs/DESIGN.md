# 설계 문서 — claude-harness v2

> 작성 근거: 사용자 PC 의 v1 하네스(`~/.harness`, v1.7) 코드와 운영 로그, KEEPING·MelonMe·holssi·bizMap·devmonitor 등 프로젝트의 `.claude/` 설정, 지난 대화에서 정한 결정.
> 이 문서는 "왜 이렇게 만들었는지"를 남깁니다. 동작 명세는 [HOOK-SPEC.md](HOOK-SPEC.md).

---

## 1. 출발점: 지금까지 만든 것과 그 한계

### 1-1. v1 하네스 (`~/.harness`, 2026-06 ~ 07, Python)
| 구성 | 동작 |
|---|---|
| UserPromptSubmit | 매 턴 약 1,500자 정책문 주입 + 프롬프트 기록 |
| PreToolUse | Edit/Write/변경성 Bash → 승인 토큰 없으면 차단, 보호 브랜치면 토큰 있어도 차단 |
| PostToolUse | ExitPlanMode 수락 → 토큰 발급, 파일 diff 저장 |
| Stop | 토큰 폐기 |
| SessionStart | main 자동 동기화 |

**운영 로그에서 확인한 것** (6/3 ~ 7/15, 도구 호출 1,193건)
- 계획 승인 31회, 차단 18회. 차단 중 상당수가 **오탐**:
  - `docker exec …` → `\bexec\b` 동적 실행 패턴에 걸림 (4회)
  - `docker … --format` → `\bformat\b` 시스템 파괴 패턴에 걸림
  - `ToolSearch`, `EnterPlanMode`, `Agent` → "알 수 없는 도구"로 fail-closed 차단 (6회)
- 세션 인덱스 11건 중 10건이 `(prompt unavailable)` — 프롬프트 기록이 대부분 실패
- 전역(`~/.claude/settings.json`) 등록이라 **모든 프로젝트에 강제** → 2026-07-22 `DISABLED` 파일로 전체 비활성화

### 1-2. 프로젝트별로 흩어진 하네스
| 프로젝트 | 있던 것 | 문제 |
|---|---|---|
| KEEPING | 도메인 에이전트 22개, cleanup/refactor/deploy 커맨드, post-edit 컴파일 훅 2개 | 컴파일 실패를 `exit 1` 로 내서 **Claude 가 실패를 못 봄**. smoke-build.sh 는 `/c/keeping/...` 하드코딩이라 폴더 이동 후 **조용히 무동작** |
| MelonMe | 도메인 탐색·코드 생성 커맨드 17개, 커밋 시 시크릿 검사 훅(인라인 셸) | 한 줄짜리 셸 스크립트라 유지보수 어려움. settings.local.json allow 131개(일회성 명령·절대경로·JWT 값까지 누적) |
| holssi / KEEPING | CLAUDE.md 에 "완료 조건 먼저 / 결정·실패 기록 / 컴팩션 지침" 같은 **같은 규칙을 복붙** | 규칙이 문서(확률적 권고)라 지켜질지 보장 없음 |
| bizMap | `.claude/hooks/` 에 Stop(PROGRESS.md 갱신 안내)·PostToolUse(패턴 경고) 스크립트 | settings 어디에도 **등록돼 있지 않음**. 등록해도 파일 경로를 `$1` 로 받는데 훅은 stdin JSON 을 주므로 동작 안 함 |
| devmonitor | "분석 전용" 규칙을 CLAUDE.md 로만 | 강제 수단 없음 |
| KEEPING v3 | 밤에 돌릴 "정적 세트"(빌드·테스트·서버·git 금지) 프롬프트를 손으로 작성 | 금지가 프롬프트 문장뿐 |

### 1-3. 사용자가 정한 요구사항 (대화)
1. GitHub 레포 하나를 **Claude Code 플러그인 마켓플레이스**로 → 어느 PC 에서든 설치
2. 스택별 플러그인 분리 (`core` / `workflow` / `stack-spring` / `stack-react`)
3. **project 범위** 설치 → 팀원이 받아도 팀원의 다른 프로젝트엔 영향 없음
4. CLAUDE.md·권한처럼 플러그인에 못 넣는 것은 `/core:init` 이 작성 (`templates/` 폴더 안 씀)
5. Windows(PowerShell) 지원, Gradle 기본·없으면 Maven
6. 수정 권한은 GitHub 레포 권한으로 (나중에)

---

## 2. 설계 원칙

1. **결정적 관문과 확률적 권고를 구분한다** — 되돌릴 수 없는 것·반복된 실수·기계 판별 가능한 것은 훅. 나머지는 CLAUDE.md/스킬.
2. **기본은 가볍게, 강도는 모드로** — v1 이 꺼진 이유는 "항상 최고 강도"였기 때문. 기본(standard)은 진짜 위험만 막고, strict/night/readonly 는 필요할 때 켠다.
3. **오탐은 버그다** — v1 로그의 오탐 명령을 회귀 테스트로 고정 (`tests/rules.test.mjs`).
4. **실패는 Claude 가 보게** — 검증 실패는 `exit 1`(사용자만 봄)이 아니라 `decision:block`/`deny` 로 Claude 에게 돌려 스스로 고치게.
5. **모델이 스스로 제한을 풀 수 없게** — 모드 변경은 사용자 프롬프트(UserPromptSubmit)로만, `.harness/mode·state` 쓰기는 차단.
6. **한 벌의 코드** — 모든 훅을 Node 로 작성하고 exec 형식(`"command":"node","args":[…]`)으로 실행. (아래 3-3)
7. **경로 하드코딩 금지** — `${CLAUDE_PLUGIN_ROOT}`, git 루트, 빌드 파일 탐색으로 위치를 찾는다.

---

## 3. 구조

### 3-1. 레포
```
claude-harness/
├── .claude-plugin/marketplace.json   마켓플레이스 "yj-harness" (플러그인 5개)
├── shared/lib/                       공통 코드 원본 (여기만 수정)
├── plugins/
│   ├── core/          가드레일·모드·이력·동기화·컴팩션·/core:init     ← 모든 프로젝트 필수
│   ├── workflow/      커밋·PR·인수인계·기록·완료조건·무인세트·worktree + 비평/검증 에이전트
│   ├── stack-spring/  컴파일·빌드 검증·Flyway 보호 + 리뷰/테스트/성능 에이전트 + 스킬 5
│   ├── stack-react/   타입체크/린트 검증 + 리뷰 에이전트 + 스킬 2
│   └── ops/           원격 명령 감사·차단 + 배포 점검/로그 분석 에이전트
├── scripts/sync-lib.mjs              shared/lib → plugins/*/lib 복사 (--check 로 CI 검사)
├── tests/                            규칙 단위 테스트 + 훅 통합 테스트 (실제 git·gradle)
└── .github/workflows/ci.yml          테스트 + lib 동기화 + claude plugin validate --strict
```
플러그인은 설치 시 서로 다른 폴더로 복사되므로 서로의 파일을 import 할 수 없습니다. 그래서 `shared/lib` 를 원본으로 두고 각 플러그인 `lib/` 에 복사합니다.

### 3-2. 프로젝트 쪽에 생기는 것
```
my-project/
├── CLAUDE.md                     /core:init 이 코드 읽고 작성 (커밋)
├── .claude/settings.json         enabledPlugins + extraKnownMarketplaces + 기본 allow (커밋)
├── .claude/harness.json          보호 브랜치, 기본 모드, 검증 강도 (커밋)
├── .claude/harness.local.json    개인 덮어쓰기 (git 제외)
├── docs/decisions.md, failures.md
└── .harness/                     런타임 (git 제외)
    ├── mode                      현재 모드 (사용자만 변경)
    ├── state/<session>.json      변경 파일·승인 토큰·검증 대상
    ├── logs/YYYY-MM-DD.jsonl     프롬프트·변경·차단·검증 이력
    ├── logs/ops-YYYY-MM.jsonl    원격 명령 감사
    ├── done-criteria.md          완료 조건
    └── compact-snapshot.md       컴팩션 직전 상태
```
v1 은 로그를 `~/.harness` 한 곳에 모았지만, v2 는 **프로젝트 안**에 둡니다. 프로젝트별로 이력을 보기 쉽고, worktree 마다 상태가 분리됩니다.

### 3-3. 왜 sh + ps1 두 벌이 아니라 Node 한 벌인가
대화에서 "Bash + PowerShell 둘 다 지원"으로 정했는데, 구현하면서 **요구사항(Windows 에서 Git Bash 없이도 동작)은 지키되 방법을 바꿨습니다.**
- Claude Code 공식 문서가 크로스플랫폼 훅으로 **exec 형식 + node** 를 권장 (셸을 거치지 않아 Git Bash/PowerShell 차이·따옴표·ExecutionPolicy 문제가 없음)
- 두 벌이면 같은 규칙을 두 번 구현·테스트해야 하고, v1 로그에서 봤듯 정규식 하나 차이가 오탐이 됨
- 사용자 PC 에 Node 가 이미 있음 (MelonMe 훅이 node 사용)
- 사용자 v1 도 Python 한 벌이었음 (Windows cp949 인코딩 문제를 매번 우회해야 했음 → Node 는 UTF-8 기본)

되돌리고 싶으면 hooks.json 의 각 항목을 `"shell":"powershell"` + `.ps1` 로 바꾸면 되지만, 권장하지 않습니다.

---

## 4. 작업 모드

| 모드 | 언제 | 막는 것 | 출처 |
|---|---|---|---|
| **standard** (기본) | 평소 | 보호 브랜치 수정·push, 시크릿 읽기, 파괴 명령, 시크릿 커밋 | v1 의 브랜치 보호 + MelonMe 커밋 훅 |
| **strict** | 본인이 민감한 코드(결제·정합성)를 다룰 때 스스로 켬 | 계획 승인 전 수정, 승인 후엔 계획 파일만 | v1 승인 게이트 |
| **night** | 자는 동안 무인 실행 | 빌드·테스트·서버·git 쓰기·설치·DB | KEEPING v3 "정적 세트" 금지 표 |
| **readonly** | 에러 분석, 코드 리딩 | 모든 수정·변경 명령 | devmonitor 규칙 |
| **ops** | 서버 작업 | 원격 명령 하나하나 확인 | KEEPING 서버 실험 거버넌스 |

전환: 사용자가 `/core:mode night` 입력 → UserPromptSubmit 훅이 `.harness/mode` 기록. 모델은 이 파일을 쓸 수 없음 (Edit/Write/Bash 모두 차단, 테스트로 확인).

### 계획 게이트는 모드가 아니라 "사람" 기준 (v2.1)
계획 강제는 기본으로 **아무에게도 걸지 않아요.** 본인과 동등한 동료는 계획 없이 바로 작업하고, 팀 설정 `planGate.requiredFor` 에 적힌 팀원만 자동으로 계획 승인이 필요해요. 본인이 원하면 `/core:mode strict` 로 스스로 켤 수 있어요.

승인 범위는 "턴"이 아니라 **계획에 적힌 파일**이에요. v1 처럼 다음 메시지마다 다시 승인받게 하면 작은 수정도 매번 계획이 필요해서 결국 꺼지게 돼요. 그래서 계획의 `## 변경 파일` 은 다음 메시지에서도 계속 수정할 수 있고, 범위 밖 파일만 새 계획을 요구해요. 끝나는 시점은 새 계획 승인 · `/core:plan-done` · 브랜치/모드 변경 · 세션 종료 · 3시간 중 먼저 오는 것이에요. 자세한 동작은 HOOK-SPEC C11.

승인 토큰을 Stop 에서 지우지 않는 이유: stack-spring 의 Stop 훅이 빌드 실패로 턴을 이어가게 할 때 토큰이 사라져 수정이 막히는 문제를 피하기 위해서예요.

---

## 5. AI 에이전트 구성

| 에이전트 | 플러그인 | 역할 | 왜 별도 에이전트인가 |
|---|---|---|---|
| plan-critic | workflow | 계획 승인 전 비판 검토 | 계획을 쓴 맥락을 모르는 상태에서 봐야 빠진 파일·위험이 보임 (자기 채점 방지) |
| verifier | workflow | 완료 조건 대비 증거 검증 | "다 했다"는 주장 대신 테스트 출력으로 판정 |
| spring-reviewer | stack-spring | 트랜잭션·쿼리 수·도메인 경계·이벤트·동시성 | MelonMe/KEEPING 에서 반복된 리뷰 포인트를 체크리스트화 |
| test-writer | stack-spring | 정상·경계·실패·동시성 테스트 | MelonMe /test 커맨드를 에이전트로 |
| perf-investigator | stack-spring | 요청당 일의 양 측정 → 변인 1개 실험 | KEEPING 성능 결론("자원↑ 처방 실패, 쿼리 수↓ 처방 성공")을 기본 가설로 |
| react-reviewer | stack-react | 훅 규칙·상태·비동기·API 계약 | |
| log-analyst | ops | 읽기 전용 에러 분석 | devmonitor 를 에이전트로 이식 |
| deploy-checker | ops | 배포 전 체크리스트 | KEEPING deploy-agent 의 "위반 금지" 규칙 일반화 |

도메인 전담 에이전트(KEEPING 22개 방식)는 프로젝트마다 다르므로 플러그인에 넣지 않고, `/stack-spring:domain-map` 이 프로젝트 안에 생성합니다.

### 왜 OMC 를 대체하지 않나
OMC 는 실행 모드(autopilot/team)와 범용 에이전트 19개를 제공합니다. 이 하네스는 **그 위에 얹는 통제·검증 계층**이라 같이 쓸 수 있습니다. 에이전트 이름도 OMC 와 겹치지 않게 했습니다 (critic → plan-critic, verifier 는 플러그인 네임스페이스 `workflow:verifier` 로 구분).

---

## 6. 검증 결과 (이 레포를 만들면서 실제로 확인한 것)

| 항목 | 방법 | 결과 |
|---|---|---|
| 규칙 단위 테스트 (v1 오탐 회귀 포함) | `node --test` | 통과 |
| 훅 통합 테스트 14개 (실제 git 레포, 실제 gradle 컴파일) | `node --test` | 통과 |
| 매니페스트 | `claude plugin validate --strict` (마켓플레이스 + 5개) | 통과 |
| 실제 Claude 세션: main 수정 차단, .env 읽기 차단, force push 차단, `docker --format` 오탐 없음 | `claude -p` + 플러그인 로드 | 의도대로 동작 |
| `/core:mode night` → 빌드·커밋·ssh 차단, 모델의 모드 파일 수정 차단 | `claude -p` | 의도대로 동작 |
| 마켓플레이스 추가 → `--scope project` 설치 → 다른 프로젝트엔 영향 없음 | `claude plugin install` | 등록 프로젝트만 차단, 미등록 프로젝트는 그대로 |
| 깨진 Java 작성 → 편집 시 컴파일 실패 전달 → Claude 가 수정 → Stop 검증 통과 | `claude -p` + gradle | 의도대로 동작 |

검증하지 못한 것: Windows 실제 실행(리눅스 컨테이너에서만 테스트), Maven 경로, React Stop 검증의 실제 프로젝트 실행, ops 훅의 실제 서버 대상 실행.
