# 훅 동작 명세

대화에서 정한 형식(목적 / 종류 / 트리거 / 동작 / 결과 / 예외)으로 모든 훅을 적었습니다.
결과 표기: **deny** = 도구 호출 거부(Claude 에게 이유 전달) · **ask** = 사용자 확인 창 · **block** = Claude 가 멈추지 않고 이유를 보고 계속 작업 · **context** = 모델 컨텍스트에 문장 추가

---

## core

### C1. 보호 브랜치 수정 차단
| 항목 | 내용 |
|---|---|
| 목적 | main 에서 바로 코드를 고치는 실수 방지 (v1 도입 계기: 브랜치 전환 없이 main 을 수정해 롤백한 일) |
| 종류 | PreToolUse |
| 트리거 | Edit · Write · MultiEdit · NotebookEdit / Bash · PowerShell |
| 동작 | 현재 브랜치가 `protectedBranches`(기본 main·master·develop)인지 확인. 파일 도구는 레포 안 파일이면, 셸은 commit·merge·rebase·cherry-pick·revert·reset·파일 쓰기 명령이면 대상 |
| 결과 | deny + "`git switch -c feature/<설명>` 먼저" 안내 → Claude 가 브랜치를 만들고 재시도 |
| 예외 | git 레포 아님 / 커밋이 하나도 없는 새 레포 / 레포 밖 파일(예: `~/.claude/plans`) / `.harness/` / `protectedBranchAllowPaths` / 브랜치 생성 명령(`git switch -c`, `git checkout -b`) / `git pull`·`fetch`·`switch` |

### C2. 보호 브랜치 push 차단
| 목적 | 원격 main 오염 방지 (커밋 → 자동 배포로 이어지는 경로 차단) |
|---|---|
| 종류 / 트리거 | PreToolUse / Bash · PowerShell 의 `git push` |
| 동작 | push 대상 ref 계산: `origin main`, `HEAD:main`, 인자 없는 push(현재 브랜치) |
| 결과 | deny + "작업 브랜치 push 후 PR" |
| 예외 | 보호 브랜치가 아닌 대상 |

### C3. 파괴·우회 명령
| 목적 | 되돌릴 수 없는 명령 차단, 손실 가능 명령은 확인 |
|---|---|
| 종류 / 트리거 | PreToolUse / Bash · PowerShell |
| deny | `rm -rf /`·`~`·`.`·`*`, `git push --force`/`-f`/`+ref`, `--no-verify`, `curl … \| sh`, mkfs·format X:, shutdown/reboot, DROP DATABASE/SCHEMA, `.harness/mode·state` 쓰기 |
| ask | `git reset --hard`, `git clean -f`, `git checkout -- .`, `git branch -D`, `--force-with-lease`, DROP/TRUNCATE TABLE, WHERE 없는 DELETE, `chmod 777`, publish/deploy, sudo |
| 예외(오탐 방지) | `docker exec`·`kubectl exec`(exec 는 세그먼트 맨 앞일 때만), `--format`, `2>&1`·`>/dev/null` 리다이렉트, WHERE 있는 DELETE |

### C4. 시크릿 보호
| 목적 | AI 컨텍스트로 시크릿 값이 들어가거나 커밋되는 것 방지 |
|---|---|
| 종류 | PreToolUse |
| 트리거 | Read · Grep (파일) / Bash (cat·type·Get-Content·head·grep 등 + 시크릿 파일, printenv, `echo $*SECRET*`) / Edit·Write (시크릿 파일 쓰기) / `git commit` |
| 대상 파일 | `.env*`(example·sample·template 제외), `*.pem·key·p12·jks`, `id_rsa`, `application-prod.*`, `credentials`, `.mcp.json`, `backend.env` — `secrets.readDeny/readAllow` 로 조정 |
| 결과 | 읽기 deny / 쓰기 ask / 커밋: 스테이징 파일·추가된 줄에서 토큰 형식(ghp_, github_pat_, sk-ant-, AKIA, PRIVATE KEY)·`password: 평문` 발견 시 deny |
| 예외 | `${ENV}` 참조, `<placeholder>`, `changeme`/`example` 값 |

### C5. 모드별 제한
| 모드 | 파일 수정 | 셸에서 막히는 것 |
|---|---|---|
| standard | 허용 | C1~C4 만 |
| strict | 계획 게이트(C11)를 본인에게 적용 | C11 참고 |
| night | 허용 | build · test · remote · git 쓰기 · install · DB |
| readonly | deny | 변경성 · build · remote · install |
| ops | 허용 | (ops 플러그인이 원격 명령마다 ask) |

### C6. 모드 전환
| 목적 | 모델이 스스로 제한을 푸는 것 방지 |
|---|---|
| 종류 / 트리거 | UserPromptSubmit / 프롬프트가 `/core:mode <이름>` 또는 `하네스 모드: <이름>` |
| 동작 | `.harness/mode` 기록 + 이력 |
| 결과 | context ("모드가 바뀌었다") |

### C7. 모호한 요청 → Plan 안내
| 목적 | "기능 만들어줘" 같은 요청에 바로 구현 들어가는 것 방지 — **기본은 계획 게이트 대상(팀원/strict)에게만** (`vaguePromptNudge`: gated / always / off) |
|---|---|
| 종류 / 트리거 | UserPromptSubmit |
| 동작 | 구현 동사(만들어·구현·고쳐·추가해·리팩토링…)가 있고, 파일명·클래스명·코드·목록 같은 구체 신호가 없고, 100자 미만이면 모호 판정 |
| 결과 | context (300자 이내): Plan 모드로 바뀔 파일·완료 조건·질문 먼저 |
| 예외 | 질문·설명·분석 요청, 슬래시 커맨드, `vaguePromptNudge:false` |

### C11. 계획 승인 게이트 (팀원 한정)
| 항목 | 내용 |
|---|---|
| 목적 | 팀원(주로 합류한 지 얼마 안 된 동료)의 AI 작업이 승인된 범위 안에서만 코드를 바꾸게. **본인과 동등한 동료에게는 강제하지 않음** |
| 누구에게 | `.claude/harness.json` 의 `planGate.requiredFor` 에 git `user.email`/`user.name` 이 있는 사람 + `/core:mode strict` 를 켠 사람. requiredFor 는 팀 공용 파일에서만 읽음 (개인 local 설정으로 못 뺌) |
| 종류 / 트리거 | PreToolUse (Edit·Write 등 / 파일 바꾸는 셸 명령) · PostToolUse(ExitPlanMode) · UserPromptSubmit(`/core:plan-done`) |
| 승인 | Plan 모드 → ExitPlanMode → 사용자 수락 = 도구 성공 → 토큰 기록 (거절하면 도구가 실패해 토큰 없음) |
| 범위 | 계획의 `## 변경 파일`(또는 Files to change / What will change) 섹션에 적힌 파일. 그 파일들은 **다음 메시지에서도 계속 수정 가능**. 계획 폴더 안의 새 파일·테스트 파일도 허용 (`allowNewFilesInPlannedDirs`, `allowTestFiles`). 섹션이 없으면 승인한 메시지에서만 |
| 끝나는 시점 | 새 계획 승인(범위 교체) · 사용자의 `/core:plan-done` · 브랜치 변경 · 모드 변경 · 세션 종료 · `ttlHours`(기본 3시간) 경과 — 먼저 오는 것 |
| 셸 명령 | rm·mv·sed -i·리다이렉트·설치·DB 는 파일 범위를 확인할 수 없어 **승인한 메시지 안에서만**. git commit/push 는 게이트 대상 아님 (브랜치·시크릿 규칙은 그대로) |
| 결과 | 승인 없음/만료 → deny + 계획 작성법 / 범위 밖 파일 → deny + 승인된 파일 목록 |
| 한계 | git 사용자 정보는 본인이 바꿀 수 있어 보안 경계가 아니라 **팀 합의 장치**예요. 실제 강제는 PR 리뷰·브랜치 보호와 함께 |

### C12. 결정 미루기 (막히면 건너뛰고 마지막에 질문)
| 항목 | 내용 |
|---|---|
| 목적 | 사람이 자리를 비워도 결정이 필요 없는 작업은 계속 진행되고, 결정할 것만 마지막에 모이게 |
| 종류 / 트리거 | PreToolUse(AskUserQuestion) · Stop · SessionStart · PreCompact |
| 동작 | 이번 메시지에서 이미 파일을 바꾸거나 변경 명령을 실행했으면 AskUserQuestion 을 deny → "`.harness/pending-decisions.md` 에 D번호로 적고, 겹치는 작업만 보류하고 계속" 안내. Stop 에서 미해결 항목(`- [ ]`)이 있으면 한 번 block 해서 질문 차례를 열고, 그 뒤엔 같은 메시지 안에서 AskUserQuestion 허용 |
| 예외 | 계획 단계(아직 아무것도 안 바꿈)의 질문, `deferQuestions:false` |
| 이어받기 | SessionStart·컴팩션 스냅샷에 미해결 목록 표시 → `/workflow:decide` |
| 한계 | 채팅 텍스트로 묻는 것은 막을 수 없어요 (규칙 안내로만) |

### C13. 다른 레포 파일의 보호 브랜치
fullstack 처럼 한 세션에서 다른 레포(예: 프론트) 파일을 고칠 때, 그 파일이 속한 레포의 현재 브랜치로 보호 브랜치 규칙을 적용해요.

### C8. 변경 이력
| 목적 | 언제·어떤 요청으로·어떤 파일이 바뀌었는지 추적 |
|---|---|
| 종류 / 트리거 | UserPromptSubmit(프롬프트) · PostToolUse(파일 변경·변경성/원격/DB 명령·계획 승인) · PreToolUse(deny/ask 결정) · Stop(턴 요약) |
| 저장 | `.harness/logs/YYYY-MM-DD.jsonl` — 토큰·JWT·비밀번호 마스킹, 30일 보관 |
| 조회 | `/core:log`, `/core:status` |

### C9. 세션 시작
| 목적 | 오래된 코드 위 작업 방지 + 다른 PC/새 세션에서 이어받기 |
|---|---|
| 종류 / 트리거 | SessionStart (startup · resume · compact · clear) |
| 동작 | startup: origin 기본 브랜치 fetch → 현재가 main 이고 깨끗하면 ff-only, 아니면 로컬 main 포인터만 갱신(뒤처진 커밋 수 표시) / startup·resume: `docs/HANDOFF.md`·`PROGRESS.md` 앞 40줄 / compact: 컴팩션 스냅샷 |
| 결과 | context (모드·브랜치·동기화 결과·보호 브랜치 경고·규칙 한 줄) |
| 예외 | origin 없음, 오프라인(fetch 실패는 경고만), 커밋 없는 레포 |

### C10. 컴팩션 스냅샷
| 목적 | CLAUDE.md "컴팩션 지침"(수정 중 파일·테스트 명령·완료 조건 보존)을 훅으로 보장 |
|---|---|
| 종류 / 트리거 | PreCompact → SessionStart(compact) |
| 동작 | 최근 요청 5개, 세션 변경 파일, `.harness/done-criteria.md`, compact 지시문을 `.harness/compact-snapshot.md` 로 저장 → 컴팩션 직후 재주입 |

---

## stack-spring

### S1. 편집 시 컴파일
| 목적 | 컴파일 오류를 다음 편집 전에 바로 고치게 |
|---|---|
| 종류 / 트리거 | PostToolUse / Edit·Write·MultiEdit 의 `.java`·`.kt` |
| 동작 | 파일에서 위로 올라가며 빌드 파일 탐색 → **gradlew → gradle → mvnw → mvn** 순. 해당 모듈만 `compileJava`(Maven `compile`) |
| 결과 | 실패 시 block + 오류 마지막 25줄 (Claude 가 봄) / 시간 초과는 context 로 알리고 Stop 에서 재검증 |
| 예외 | `spring.compileOnEdit:false`, 빌드 파일 없음 |

### S2. 턴 종료 빌드 검증
| 목적 | "다 했어요"라고 했는데 컴파일도 안 되는 상황 제거 |
|---|---|
| 종류 / 트리거 | Stop |
| 동작 | 이번 세션에 Java/Kotlin 을 바꾼 모듈만. `verifyOnStop`: compile(main+test 컴파일, 기본) / test / off. night 모드면 test 대신 compile |
| 결과 | 실패: block(이유+오류) → Claude 가 이어서 수정. 통과: 사용자에게 "✓ 검증 통과" |
| 예외 | 연속 실패 `stopLoopLimit`(3)회 초과 시 붙잡지 않고 사용자에게 넘김. readonly 모드 |

### S3. 적용된 Flyway 마이그레이션 수정 차단
| 목적 | checksum 불일치로 기동 실패 방지 (MelonMe 규칙을 훅으로 승격) |
|---|---|
| 종류 / 트리거 | PreToolUse / Edit·Write·MultiEdit 의 기존 `db/migration/V*__*.sql` |
| 결과 | deny + 새 버전 파일 안내 |
| 예외 | 새 파일, `spring.blockEditingAppliedMigrations:false` |

### S4. 설정 파일 하드코딩 시크릿 경고
| 목적 | yml 에 평문 비밀번호가 들어가는 것 조기 발견 (KEEPING check-env.sh 일반화) |
|---|---|
| 종류 / 트리거 | PostToolUse / `application*.yml·yaml·properties` |
| 결과 | context: 해당 줄 번호와 키 (값은 가림), `${ENV}` 로 바꾸라는 안내 |

---

## stack-react

### R1. 턴 종료 타입체크/린트
| 목적 | 프론트 변경 후 타입 오류 방치 방지 |
|---|---|
| 종류 / 트리거 | PostToolUse(변경 패키지 기록) → Stop |
| 동작 | lockfile 로 pnpm/yarn/bun/npm 판별. `verifyOnStop`: typecheck(기본: scripts.typecheck → `tsc --noEmit` → lint) / lint / build / off |
| 결과 | 실패 block, 통과 메시지, 3회 초과 시 넘김 |

---

## ops

### O1. 원격 명령 관문
| 목적 | AI 의 서버 접근 범위 통제 (KEEPING 실험에서 AI 가 서버 터미널에 접속해 변인을 바꾼 경험) |
|---|---|
| 종류 / 트리거 | PreToolUse / ssh·scp·rsync·sftp·aws·kubectl·helm·gcloud·az·docker -H·terraform |
| deny | 원격 rm -rf, docker rm/prune/compose down/stop, systemctl stop/restart, kill -9, DROP/TRUNCATE/DELETE, shutdown, aws terminate/delete/s3 rm, kubectl delete/drain, terraform destroy, crontab -r |
| ask | prod/production/live 키워드, `ops.allowedHosts` 밖 호스트, ops 모드의 모든 원격 명령 |
| 결과 | 모든 판단을 `.harness/logs/ops-YYYY-MM.jsonl` 에 기록 |

### O2. 원격 실행 감사
| 종류 / 트리거 | PostToolUse / 원격 명령 |
|---|---|
| 동작 | 호스트·명령·실패 여부·출력 앞 600자 기록 → `/ops:audit`, `/ops:incident` 타임라인 재료 |

---

## fullstack (백엔드·프론트 분리 레포)

### F1. API 계약 검사 (백엔드 레포)
| 항목 | 내용 |
|---|---|
| 목적 | DTO 필드 이름을 바꿔도 양쪽 빌드는 통과하고 화면에서야 깨지는 문제 방지 |
| 종류 / 트리거 | PostToolUse(Controller·DTO·Request·Response·ErrorCode·Advice 파일 수정 표시) → Stop |
| 동작 | springdoc-openapi-gradle-plugin `generateOpenApiDocs` 로 `build/openapi.json` 생성 → 커밋된 스냅샷 `docs/api/openapi.json` 과 비교 → 스냅샷 갱신, `docs/api/API_CHANGES.md` 기록 |
| 깨지는 변경 | 엔드포인트 삭제, 필드 삭제·타입 변경·enum 값 삭제, 요청 필수 필드·필수 파라미터 추가, 응답/요청 스키마 교체 |
| 결과 | 깨지는 변경이면 프론트 레포에서 사용처를 찾아 `[화면]`(컴포넌트)/`[코드]`(API·타입) 로 나눠 block 한 번. 원칙: `[코드]` 는 프론트를 고치고, `[화면]` 에서 보이던 값이 사라지거나 의미가 바뀌면 결정 대기 목록(C12)으로 → 마지막에 개발자에게 질문. 호환 변경은 "프론트에서 /fullstack:api-sync" 안내 |
| 예외 | night·readonly 모드(앱을 띄울 수 없음 → 표시만 남기고 다음에 검사), 명세 생성 실패(경고만) |

### F2. 계약 갱신 알림 (프론트 레포)
SessionStart 에서 백엔드 스냅샷이 프론트 생성 타입(`src/api/generated/schema.ts`)보다 새로우면 `/fullstack:api-sync` 를 제안해요.
