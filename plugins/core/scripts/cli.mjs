#!/usr/bin/env node
// core / cli — 슬래시 커맨드가 호출하는 결정적 도우미
//   node cli.mjs status            현재 모드·브랜치·설정 요약
//   node cli.mjs log [N]           최근 차단/변경 이력 N건
//   node cli.mjs detect            스택 감지 결과(JSON)
//   node cli.mjs init [--apply] [--stacks spring,react,backend,frontend] [--marketplace owner/repo]
//                                  .claude/harness.json, .claude/settings.json(플러그인 등록·allow), .gitignore 계획/적용
//   node cli.mjs doctor            설치 상태 점검
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, loadConfig, DEFAULTS } from '../lib/config.mjs';
import { getMode, MODES, harnessDir } from '../lib/state.mjs';
import { currentBranch, isGitRepo, run } from '../lib/proc.mjs';
import { detectStacks } from '../lib/build-detect.mjs';
import { gateStatus, teamRequiredFor } from '../lib/plan-gate.mjs';

const MARKETPLACE = 'yj-harness';
const DEFAULT_REPO = 'welikeWatermelon/claude-harness';

const args = process.argv.slice(2);
const cmd = args[0] || 'status';
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const root = projectRoot({ cwd: process.cwd() });
const cfg = loadConfig(root);

function readJson(f, fallback) {
  try {
    return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
  } catch {
    return fallback;
  }
}

function status() {
  const mode = getMode(root, cfg);
  const b = isGitRepo(root) ? currentBranch(root) : null;
  console.log(`프로젝트: ${root}`);
  console.log(`모드: ${mode} — ${MODES[mode]}`);
  console.log(`브랜치: ${b || '(git 아님/커밋 없음)'}${b && cfg.protectedBranches.includes(b) ? '  ⚠ 보호 브랜치' : ''}`);
  console.log(`보호 브랜치: ${cfg.protectedBranches.join(', ')}`);
  const g = gateStatus(root, mode);
  const req = teamRequiredFor(root);
  console.log(`계획 게이트: ${g.active ? `적용 (${g.reason === 'team-member' ? '팀 설정 대상' : 'strict 모드'})` : '미적용'} — 현재 git 사용자: ${g.who}`);
  console.log(`  게이트 대상 팀원(planGate.requiredFor): ${req.length ? req.join(', ') : '(없음)'} / 승인 유지: ${cfg.planGate.scope === 'files' ? `계획 파일 한정, ${cfg.planGate.ttlHours}시간` : '승인한 메시지에서만'}`);

  console.log(`Spring 검증: 편집 시 컴파일=${cfg.spring.compileOnEdit}, 턴 종료 시=${cfg.spring.verifyOnStop}`);
  console.log(`React 검증: 턴 종료 시=${cfg.react.verifyOnStop}, eslint --fix=${cfg.react.eslintFixOnEdit}, 관련 테스트=${cfg.react.testOnStop}`);
  console.log(`Backend/Frontend 검증: ${cfg.backend.verifyOnStop} / ${cfg.frontend.verifyOnStop}`);
  const ov = Object.entries(cfg.rules || {}).filter(([k]) => !k.startsWith('$'));
  console.log(`규칙 덮어쓰기: ${ov.length ? ov.map(([k, v]) => `${k}=${v}`).join(', ') : '(없음 — 기본 강도)'}`);
  console.log(`설정 파일: .claude/harness.json ${existsSync(path.join(root, '.claude/harness.json')) ? '있음' : '없음(기본값 사용)'}`);
  console.log(`모드 목록: ${Object.keys(MODES).join(' | ')}  (바꾸기: /core:mode <이름>)`);
}

function log(n = 20) {
  const dir = path.join(harnessDir(root), 'logs');
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    console.log('로그 없음');
    return;
  }
  const lines = [];
  for (const f of files.slice(-7)) {
    for (const l of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const e = JSON.parse(l);
        if (['guard', 'file_change', 'command', 'plan_approved', 'plan_done', 'mode_change', 'verify'].includes(e.type)) lines.push(e);
      } catch {}
    }
  }
  for (const e of lines.slice(-n)) {
    const t = e.ts.replace('T', ' ').slice(0, 19);
    if (e.type === 'guard') console.log(`${t} [${e.decision}] ${e.rule} — ${e.tool} ${e.command || e.reason || ''}`.slice(0, 220));
    else if (e.type === 'file_change') console.log(`${t} [변경] ${e.file} (+${e.added}/-${e.removed}) ← "${e.prompt || ''}"`.slice(0, 220));
    else if (e.type === 'command') console.log(`${t} [명령] ${e.command}`.slice(0, 220));
    else if (e.type === 'plan_approved') console.log(`${t} [계획 승인] ${e.summary}${e.files && e.files.length ? ` (범위: ${e.files.join(', ')})` : ' (이번 메시지 한정)'}`);
    else if (e.type === 'plan_done') console.log(`${t} [계획 종료] ${(e.files || []).join(', ')}`);
    else if (e.type === 'mode_change') console.log(`${t} [모드] ${e.from} → ${e.to}`);
    else if (e.type === 'verify') console.log(`${t} [검증 ${e.ok ? '통과' : '실패'}] ${e.target || ''} ${e.goal || ''}`);
  }
  const counts = lines.filter((e) => e.type === 'guard').reduce((m, e) => ((m[e.rule] = (m[e.rule] || 0) + 1), m), {});
  if (Object.keys(counts).length) console.log(`\n최근 7일 차단/확인 규칙별 횟수: ${JSON.stringify(counts)}`);
}

const BASE_ALLOW = [
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git branch:*)',
  'Bash(git fetch:*)',
  'Bash(git switch -c:*)',
  'Bash(git checkout -b:*)',
  'Bash(ls:*)',
  'Bash(find:*)',
  'Bash(grep:*)',
  'Bash(rg:*)',
  'Bash(wc:*)',
];
const STACK_ALLOW = {
  spring: ['Bash(./gradlew compileJava:*)', 'Bash(./gradlew compileTestJava:*)', 'Bash(./gradlew test:*)', 'Bash(./gradlew build:*)', 'Bash(./mvnw compile:*)', 'Bash(./mvnw test:*)'],
  react: ['Bash(npm run lint:*)', 'Bash(npm run build:*)', 'Bash(npm test:*)', 'Bash(npx tsc --noEmit:*)', 'Bash(pnpm lint:*)', 'Bash(pnpm build:*)'],
  backend: ['Bash(npm run lint:*)', 'Bash(npm test:*)', 'Bash(npx tsc --noEmit:*)', 'Bash(go build:*)', 'Bash(go vet:*)', 'Bash(go test:*)', 'Bash(python -m pytest:*)', 'Bash(python3 -m pytest:*)', 'Bash(pytest:*)', 'Bash(ruff check:*)'],
  frontend: ['Bash(npm run lint:*)', 'Bash(npm run build:*)', 'Bash(npx vue-tsc --noEmit:*)', 'Bash(npx nuxi typecheck:*)', 'Bash(./gradlew :app:compileDebugSources:*)', 'Bash(./gradlew lintDebug:*)', 'Bash(./gradlew testDebugUnitTest:*)'],
};

function init() {
  const apply = args.includes('--apply');
  const stacks = (flag('stacks') || detectStacks(root).join(',')).split(',').filter(Boolean);
  const repo = flag('marketplace') || DEFAULT_REPO;
  const plan = [];

  // 1) .claude/harness.json — 팀 공용 설정 (없을 때만)
  const hjPath = path.join(root, '.claude', 'harness.json');
  if (!existsSync(hjPath)) {
    const hj = {
      $comment: '하네스 설정. 기본값은 플러그인 lib/config.mjs 의 DEFAULTS. 개인 설정은 .claude/harness.local.json',
      protectedBranches: DEFAULTS.protectedBranches,
      defaultMode: 'standard',
      planGate: {
        $comment: '여기 적은 팀원(git user.email 또는 user.name)만 파일 수정 전 계획 승인이 필요해요. 비워두면 아무에게도 강제하지 않아요.',
        requiredFor: [],
        ttlHours: 3,
      },
      ...(stacks.includes('spring') ? { spring: { compileOnEdit: true, verifyOnStop: 'compile' } } : {}),
      ...(stacks.includes('react') ? { react: { verifyOnStop: 'typecheck', eslintFixOnEdit: true, testOnStop: true } } : {}),
      ...(stacks.includes('backend') ? { backend: { verifyOnStop: 'check' } } : {}),
      ...(stacks.includes('frontend') ? { frontend: { verifyOnStop: 'check' } } : {}),
      rules: { $comment: '코드 규칙 강도 덮어쓰기: off | warn | block. 예: { "S6": "off", "R4": "block" } — 규칙 목록은 하네스 README' },
    };
    plan.push({ file: '.claude/harness.json', action: 'create', content: hj });
    if (apply) {
      mkdirSync(path.dirname(hjPath), { recursive: true });
      writeFileSync(hjPath, JSON.stringify(hj, null, 2) + '\n', 'utf8');
    }
  } else plan.push({ file: '.claude/harness.json', action: 'keep' });

  // 2) .claude/settings.json — 플러그인 project 범위 등록 + 기본 allow (기존 값과 병합)
  const spPath = path.join(root, '.claude', 'settings.json');
  const sp = readJson(spPath, {});
  sp.extraKnownMarketplaces = sp.extraKnownMarketplaces || {};
  sp.extraKnownMarketplaces[MARKETPLACE] = sp.extraKnownMarketplaces[MARKETPLACE] || { source: { source: 'github', repo } };
  sp.enabledPlugins = sp.enabledPlugins || {};
  const plugins = ['core', 'workflow', ...stacks.map((s) => `stack-${s}`)];
  for (const p of plugins) sp.enabledPlugins[`${p}@${MARKETPLACE}`] = true;
  sp.permissions = sp.permissions || {};
  const allow = new Set(sp.permissions.allow || []);
  for (const a of [...BASE_ALLOW, ...stacks.flatMap((s) => STACK_ALLOW[s] || [])]) allow.add(a);
  sp.permissions.allow = [...allow];
  plan.push({ file: '.claude/settings.json', action: existsSync(spPath) ? 'merge' : 'create', plugins, allowCount: sp.permissions.allow.length });
  if (apply) {
    mkdirSync(path.dirname(spPath), { recursive: true });
    writeFileSync(spPath, JSON.stringify(sp, null, 2) + '\n', 'utf8');
  }

  // 3) .gitignore — 런타임 폴더와 개인 설정 제외
  const giPath = path.join(root, '.gitignore');
  const gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
  const want = ['.harness/', '.claude/harness.local.json', '.claude/settings.local.json'];
  const missing = want.filter((w) => !gi.split(/\r?\n/).includes(w));
  if (missing.length) {
    plan.push({ file: '.gitignore', action: 'append', lines: missing });
    if (apply) writeFileSync(giPath, gi + (gi && !gi.endsWith('\n') ? '\n' : '') + '\n# Claude harness\n' + missing.join('\n') + '\n', 'utf8');
  }
  // .claude/ 전체가 gitignore 되어 있으면 팀 공유가 안 됨 → 경고
  if (/^\/?\.claude\/?\s*$/m.test(gi)) plan.push({ warning: '.gitignore 가 .claude/ 전체를 제외하고 있어요. 팀과 플러그인 설정을 공유하려면 .claude/settings.json 과 .claude/harness.json 은 커밋되도록 예외(!.claude/settings.json)를 추가해야 해요.' });

  // 4) 기록 파일 (없을 때만)
  for (const [f, body] of [
    ['docs/decisions.md', '# 결정 기록\n\n형식: 날짜 | 결정 | 이유\n\n'],
    ['docs/failures.md', '# 실패 기록\n\n같은 실수가 두 번 나오면 여기에 남기고, 재발 방지 방법(훅 승격 여부)을 함께 적어요.\n\n| 날짜 | 무엇이 잘못됐나 | 원인 | 재발 방지 (규칙/훅) |\n|---|---|---|---|\n'],
  ]) {
    const abs = path.join(root, f);
    if (!existsSync(abs)) {
      plan.push({ file: f, action: 'create' });
      if (apply) {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body, 'utf8');
      }
    }
  }
  console.log(JSON.stringify({ root, stacks, applied: apply, plan }, null, 2));
}

function doctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push([`Node ${process.versions.node}`, nodeMajor >= 18]);
  checks.push(['git 설치', run('git', ['--version']).ok]);
  checks.push(['git 레포', isGitRepo(root)]);
  checks.push(['.claude/harness.json', existsSync(path.join(root, '.claude/harness.json'))]);
  const sp = readJson(path.join(root, '.claude/settings.json'), {});
  checks.push(['settings.json 에 core 등록', !!sp.enabledPlugins?.[`core@${MARKETPLACE}`]]);
  const gi = existsSync(path.join(root, '.gitignore')) ? readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
  checks.push(['.gitignore 에 .harness/', gi.includes('.harness/')]);
  const legacy = path.join(process.env.USERPROFILE || process.env.HOME || '', '.harness');
  if (existsSync(path.join(legacy, 'hooks'))) {
    const userSettings = readJson(path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'settings.json'), {});
    const legacyHooked = JSON.stringify(userSettings.hooks || {}).includes('.harness');
    checks.push([`v1 하네스(~/.harness) 전역 훅 ${legacyHooked ? '아직 등록됨 → 중복 실행 위험, ~/.claude/settings.json 에서 제거 권장' : '미등록'}`, !legacyHooked]);
  }
  for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
}

if (cmd === 'status') status();
else if (cmd === 'log') log(Number(args[1]) || 20);
else if (cmd === 'detect') console.log(JSON.stringify({ root, stacks: detectStacks(root) }));
else if (cmd === 'init') init();
else if (cmd === 'doctor') doctor();
else console.log('사용법: cli.mjs status|log [N]|detect|init [--apply]|doctor');
