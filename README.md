# claude-harness

Claude Code 를 "코드 생성기"가 아니라 **통제·검증되는 작업자**로 쓰기 위한 개인 하네스.
GitHub 레포 하나가 Claude Code **플러그인 마켓플레이스(`yj-harness`)** 이고, 프로젝트마다 필요한 플러그인만 **project 범위**로 켭니다.

| 플러그인 | 무엇을 하나 | 언제 켜나 |
|---|---|---|
| **core** | 보호 브랜치·위험 명령·시크릿 차단, 작업 모드(standard/strict/night/readonly/ops), 변경 이력, main 자동 동기화, 컴팩션 스냅샷, `/core:init` | 모든 프로젝트 |
| **workflow** | 논리 단위 커밋, PR 설명, 인수인계, 결정·실패 기록, 완료 조건 합의, 무인 실행 프롬프트 세트, worktree / plan-critic·verifier 에이전트 | 모든 프로젝트 |
| **stack-spring** | Java 편집 시 컴파일, 끝내기 전 빌드 검증, Flyway 보호 / 리뷰·테스트·성능 에이전트, 스킬 5개 (Gradle 우선, 없으면 Maven) | Spring Boot |
| **stack-react** | 끝내기 전 타입체크/린트 / 리뷰 에이전트, 스킬 2개 | React |
| **ops** | 원격 명령 감사 로그·파괴 명령 차단·prod 확인 / 배포 점검·로그 분석 에이전트 | 서버 작업하는 프로젝트 |

요구사항: Claude Code, **Node.js 18+** (훅이 node 로 실행돼요), git.

---

## 설치

**① PC 마다 한 번** — Claude Code 안에서
```
/plugin marketplace add welikeWatermelon/claude-harness
```

**② 프로젝트마다 한 번** — 그 프로젝트 폴더에서 연 Claude Code 안에서
```
/plugin install core@yj-harness        → 범위: project 선택
/core:init
```
`/core:init` 이 스택(Spring/React)을 감지해서 `CLAUDE.md` 를 코드 기준으로 작성하고, `.claude/settings.json` 에 필요한 플러그인(core·workflow·stack-*)을 등록해요. Claude Code 를 다시 열면 나머지 플러그인 설치 안내가 뜹니다. 생긴 파일을 커밋하세요.

**③ 팀원** — clone 후 그 폴더에서 Claude Code 실행 → 설치 안내 승인. 팀원의 다른 프로젝트에는 영향 없어요.

**④ 하네스를 고친 뒤** — 레포에 push 하고, 각 PC 의 Claude Code 안에서
```
/plugin marketplace update yj-harness
```
(`/plugin` → Marketplaces → yj-harness → Enable auto-update 를 켜두면 생략 가능)

> 터미널에서 하려면 (PowerShell/Git Bash, 프로젝트 루트):
> `claude plugin install core@yj-harness --scope project`

---

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `/core:mode night` | 자기 전에. 파일 편집만 허용, 빌드·테스트·서버·git 쓰기 차단 |
| `/core:mode strict` | 본인에게 계획 게이트 켜기 (승인 전 수정 차단, 승인 후엔 계획 파일만) |
| `/core:plan-done` | 승인받은 계획 끝내기 |
| `/core:mode readonly` | 분석만 |
| `/core:mode standard` | 기본으로 복귀 |
| `/core:status` · `/core:log` | 현재 상태 · 언제 어떤 요청으로 무엇이 바뀌었나 |
| `/workflow:done <작업>` | 완료 조건(통과할 테스트 목록) 먼저 합의 |
| `/workflow:commit` | 논리 단위로 나눠 커밋 (계획 먼저 보여줌) |
| `/workflow:handoff` | 다른 노트북에서 이어받을 인수인계 작성 |
| `/workflow:failure <실수>` | 실패 기록 + 훅 승격 검토 |
| `/workflow:night-prompt <목표>` | 무인 실행용 프롬프트 세트 생성 |
| `/stack-spring:domain-map` | 도메인별 CLAUDE.md + 전담 에이전트 생성 |
| `/ops:deploy-check` · `/ops:triage` · `/ops:audit` | 배포 점검 · 에러 분석 · 원격 명령 감사 |

---

## 설정 (`.claude/harness.json`, 개인은 `.claude/harness.local.json`)
```json
{
  "protectedBranches": ["main", "master", "develop"],
  "defaultMode": "standard",
  "planGate": { "requiredFor": ["newbie@team.com"], "ttlHours": 3 },
  "spring": { "compileOnEdit": true, "verifyOnStop": "compile" },
  "react": { "verifyOnStop": "typecheck" },
  "ops": { "allowedHosts": ["10.0.1.12"], "prodKeywords": ["prod"] }
}
```
- `planGate.requiredFor`: 여기 적은 팀원(git user.email 또는 user.name)만 **파일 수정 전 계획 승인**이 필요해요. 비워두면 아무에게도 강제하지 않아요. 승인 후엔 계획의 `## 변경 파일` 목록을 3시간 동안(또는 `/core:plan-done`·새 계획·브랜치 변경까지) 계속 수정할 수 있어요.

전체 기본값: `shared/lib/config.mjs` 의 `DEFAULTS`.

---

## 개발

```bash
# 공통 코드는 shared/lib 만 고치고 복사
node scripts/sync-lib.mjs
# 테스트 (실제 git 레포를 만들어 훅을 실행, gradle 있으면 컴파일 검증까지)
node --test tests/*.test.mjs
# 매니페스트 검증
claude plugin validate . --strict
```
문서: [설계](docs/DESIGN.md) · [훅 명세](docs/HOOK-SPEC.md) · [v1 에서 옮기기](docs/MIGRATION-FROM-V1.md) · [로드맵](docs/ROADMAP.md)
