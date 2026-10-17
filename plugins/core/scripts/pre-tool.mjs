#!/usr/bin/env node
// core / PreToolUse — 가드레일의 중심
//   1) 하네스 상태 파일 보호   2) 시크릿 읽기 차단   3) 보호 브랜치 수정 차단
//   4) 위험 Bash 차단/확인     5) 커밋 시 시크릿 스캔   6) 모드별 제한(night/readonly)
//   7) 계획 승인 게이트 — strict 모드이거나 팀 설정 planGate.requiredFor 에 있는 팀원일 때만
import path from 'node:path';
import { runHook, deny, ask, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig, toolFilePath, isSecretPath, matchesAny } from '../lib/config.mjs';
import { currentBranch, hasCommits, isGitRepo, isInside, stagedFiles, stagedDiff } from '../lib/proc.mjs';
import { classify, pushTargetsProtected, isGitCommit, isBranchCreate } from '../lib/bash-rules.mjs';
import { getMode, loadSession, MODES } from '../lib/state.mjs';
import { gateStatus, tokenValid, fileInScope } from '../lib/plan-gate.mjs';
import { logEvent } from '../lib/logger.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const GATE_WHO = (g) => (g.reason === 'team-member' ? `팀 설정(planGate.requiredFor)에 따라 ${g.who} 님은 계획 승인 후 수정해요` : 'strict 모드예요');
const PLAN_HOWTO =
  '1) EnterPlanMode 로 들어가 Read/Grep 으로 분석\n' +
  '2) 계획에 반드시 "## 변경 파일" 섹션을 두고 바꿀 파일 경로를 한 줄에 하나씩 적기 (+ 변경 내용·실행할 명령·위험·롤백)\n' +
  '3) ExitPlanMode → 사용자가 수락하면 그 파일들은 다음 메시지에서도 계속 수정 가능\n' +
  '   (끝나는 시점: 새 계획 승인 · 사용자의 /core:plan-done · 브랜치/모드 변경 · 세션 종료 · 시간 만료)';

function gateCheck(root, cfg, sessionId, mode) {
  const g = gateStatus(root, mode);
  if (!g.active) return { g, active: false };
  const s = loadSession(root, sessionId);
  const v = tokenValid(s.token, { branch: currentBranch(root), mode, ttlHours: cfg.planGate.ttlHours, promptCount: s.promptCount || 0 });
  return { g, active: true, s, v };
}

const BRANCH_MSG = (b) =>
  `보호 브랜치 '${b}' 에서는 코드를 바꿀 수 없어요.\n` +
  `먼저 작업 브랜치를 만들고 다시 시도하세요:\n  git switch -c feature/<짧은-설명>\n` +
  `(브랜치 생성 명령은 차단하지 않아요. '${b}' 반영은 PR/merge 로만 합니다.)`;

const STAGED_SECRET_FILES = /(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]+)?|[^/]*\.(pem|key|p12|pfx|jks)|id_(rsa|ed25519)|application-(local|prod)\.(ya?ml|properties)|backend\.env|\.mcp\.json)$/i;
const SECRET_IN_DIFF = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(password|passwd|secret|api[_-]?key|access[_-]?key|token)\s*[:=]\s*["']?(?!\$\{|\$\(|<|your|changeme|example|xxx)[^\s"'#]{6,}/i,
];

function scanStaged(root) {
  const files = stagedFiles(root);
  const badFiles = files.filter((f) => STAGED_SECRET_FILES.test(f));
  const added = stagedDiff(root)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const hits = [];
  for (const l of added) {
    if (SECRET_IN_DIFF.some((re) => re.test(l))) hits.push(l.slice(0, 80).replace(/([:=]\s*["']?)[^\s"']{4}[^\s"']*/, '$1****'));
    if (hits.length >= 3) break;
  }
  return { badFiles, hits };
}

function modeDenyForBash(mode, c) {
  const cats = c.categories;
  if (mode === 'readonly') {
    if (c.mutating || cats.has('build') || cats.has('remote') || cats.has('install')) return `readonly 모드예요 — 분석만 하고 변경·빌드·원격 명령은 실행하지 않아요. 수정 제안은 텍스트로 출력하세요.`;
  }
  if (mode === 'night') {
    for (const k of ['build', 'test', 'remote', 'gitWrite', 'install', 'db']) {
      if (cats.has(k)) return `night(무인) 모드예요 — 빌드·테스트·서버 접속·git 쓰기·설치·DB 명령은 실행하지 않아요(분류: ${k}). 파일 편집만 하고, 실행이 필요한 검증은 워크로그에 "사람이 실행할 명령"으로 남기세요.`;
    }
  }
  return null;
}

await runHook(
  async (input) => {
    const tool = input.tool_name || '';
    const ti = input.tool_input || {};
    const sessionId = input.session_id;
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const mode = getMode(root, cfg);
    const log = (decision, rule, reason, extra = {}) => logEvent(root, cfg, sessionId, 'guard', { tool, decision, rule, reason, mode, ...extra });

    // ---------- Read / Grep: 시크릿 파일 ----------
    if (tool === 'Read' || tool === 'Grep') {
      const f = toolFilePath(ti);
      if (f && isSecretPath(f, cfg)) {
        log('deny', 'secret-read', f, { file: f });
        deny(`시크릿 파일(${path.basename(f)})은 읽지 않아요. 필요한 키 이름이나 형식은 사용자에게 물어보거나 .env.example 을 참고하세요.`);
      }
      return pass();
    }

    // ---------- 파일 수정 도구 ----------
    if (EDIT_TOOLS.has(tool)) {
      const f = toolFilePath(ti);
      const abs = f ? path.resolve(root, f) : null;
      const rel = abs ? path.relative(root, abs).replace(/\\/g, '/') : '';
      const inRepo = abs && isInside(root, abs);

      if (inRepo && /^\.harness\/(mode|state\/|logs\/|compact-snapshot)/.test(rel)) {
        log('deny', 'harness-tamper', rel);
        deny('하네스 상태 파일(.harness/mode·state·logs)은 하네스만 기록해요. 모드 변경은 사용자가 /core:mode 로 합니다. (.harness/done-criteria.md, .harness/worklog/ 는 수정 가능)');
      }
      if (mode === 'readonly') {
        log('deny', 'mode-readonly', rel);
        deny(`readonly 모드예요 — 파일을 수정하지 않아요. 수정안은 diff 형태 텍스트로 제시하세요. (모드: ${MODES.readonly})`);
      }
      if (inRepo && isGitRepo(root) && hasCommits(root)) {
        const b = currentBranch(root);
        if (b && cfg.protectedBranches.includes(b) && !rel.startsWith('.harness/') && !cfg.protectedBranchAllowPaths.some((p) => rel.startsWith(p))) {
          log('deny', 'protected-branch', rel, { branch: b });
          deny(BRANCH_MSG(b));
        }
      }
      if (inRepo && !rel.startsWith('.harness/')) {
        const gc = gateCheck(root, cfg, sessionId, mode);
        if (gc.active) {
          if (!gc.v.ok) {
            log('deny', 'plan-gate', rel, { why: gc.v.why, who: gc.g.who, gate: gc.g.reason });
            deny(`${GATE_WHO(gc.g)} — ${gc.v.why}.\n${PLAN_HOWTO}`);
          }
          const inScope = fileInScope(gc.s.token, rel, abs, cfg.planGate);
          if (!inScope.ok) {
            log('deny', 'plan-scope', rel, { who: gc.g.who, planned: gc.s.token.files });
            deny(
              `'${rel}' 은(는) 승인된 계획의 변경 파일 목록에 없어요.\n` +
                `승인된 파일: ${gc.s.token.files.join(', ') || '(없음)'}\n` +
                '이 파일이 필요하면 이 파일을 포함한 새 계획을 세워 ExitPlanMode 로 다시 승인받으세요 (새 승인은 이전 범위를 대체해요).',
            );
          }
        }
      }
      if (f && isSecretPath(f, cfg)) {
        log('ask', 'secret-write', rel);
        ask(`시크릿 파일(${path.basename(f)})을 수정하려고 해요. 실제 값이 들어가는지 확인해주세요.`);
      }
      if (/^\.claude\/(settings(\.local)?|harness(\.local)?)\.json$/.test(rel)) {
        log('ask', 'harness-config-edit', rel);
        ask(`하네스/권한 설정(${rel})을 바꾸려고 해요. 가드레일이 약해지지 않는지 확인해주세요.`);
      }
      return pass();
    }

    // ---------- 셸 명령 ----------
    if (SHELL_TOOLS.has(tool)) {
      const cmd = String(ti.command || '');
      const c = classify(cmd);
      const cats = [...c.categories].join(',');

      if (c.verdict === 'deny') {
        log('deny', c.rule, c.reason, { command: cmd.slice(0, 300), cats });
        deny(`[하네스] ${c.reason}`);
      }

      const modeReason = modeDenyForBash(mode, c);
      if (modeReason) {
        log('deny', `mode-${mode}`, modeReason, { command: cmd.slice(0, 300), cats });
        deny(modeReason);
      }

      if (isGitRepo(root)) {
        const b = currentBranch(root);
        const pushed = pushTargetsProtected(cmd, cfg.protectedBranches, b);
        if (pushed) {
          log('deny', 'push-protected', pushed, { command: cmd.slice(0, 300) });
          deny(`보호 브랜치 '${pushed}' 로 직접 push 할 수 없어요. 작업 브랜치를 push 하고 PR 을 만드세요.`);
        }
        const onProtected = b && cfg.protectedBranches.includes(b) && hasCommits(root);
        if (onProtected && !isBranchCreate(cmd)) {
          const writesHere =
            isGitCommit(cmd) ||
            /\bgit\s+(merge|rebase|cherry-pick|revert|am|apply|reset)\b/.test(cmd) ||
            (c.categories.has('fsWrite') && !/\.harness/.test(cmd));
          if (writesHere) {
            log('deny', 'protected-branch-bash', cmd.slice(0, 200), { branch: b });
            deny(BRANCH_MSG(b));
          }
        }
        if (isGitCommit(cmd)) {
          const { badFiles, hits } = scanStaged(root);
          if (badFiles.length || hits.length) {
            const lines = [
              '커밋에 시크릿이 섞여 있는 것 같아요.',
              ...badFiles.map((f) => `  - 스테이징된 민감 파일: ${f}`),
              ...hits.map((h) => `  - 하드코딩 의심: ${h}`),
              '해당 파일을 unstage(git restore --staged <file>)하고 값은 환경변수(${VAR})로 바꾸세요.',
            ];
            log('deny', 'commit-secret', lines.join(' | '));
            deny(lines.join('\n'));
          }
        }
      }

      // 계획 게이트: 파일을 바꾸는 셸 명령(rm·mv·sed -i·리다이렉트·설치·DB)은 파일 단위로 범위를 확인할 수 없어서
      // "승인받은 그 메시지" 안에서만 허용. git commit/push 는 코드 내용을 바꾸지 않아 게이트 대상 아님 (브랜치·시크릿 규칙은 그대로)
      const gatedCats = ['fsWrite', 'install', 'db', 'dynamic'].filter((k) => c.categories.has(k));
      if (gatedCats.length && !isBranchCreate(cmd)) {
        const gc = gateCheck(root, cfg, sessionId, mode);
        if (gc.active) {
          const sameTurn = gc.v.ok && gc.s.token.turn === (gc.s.promptCount || 0);
          if (!sameTurn) {
            log('deny', 'plan-gate-bash', cmd.slice(0, 200), { cats, who: gc.g.who, why: gc.v.why });
            deny(
              `${GATE_WHO(gc.g)} — 파일을 바꾸는 명령(${gatedCats.join(',')})은 계획을 승인받은 그 메시지 안에서만 실행할 수 있어요.${gc.v.ok ? '' : ` (${gc.v.why})`}\n` +
                '가능하면 Edit/Write 도구로 바꾸세요 (승인된 파일은 계속 수정 가능). 셸 명령이 꼭 필요하면 계획에 그대로 적고 다시 승인받으세요.',
            );
          }
        }
      }

      if (c.verdict === 'ask') {
        log('ask', c.rule, c.reason, { command: cmd.slice(0, 300) });
        ask(`[하네스] ${c.reason}`);
      }
      return pass();
    }

    return pass();
  },
  { failClosed: true, name: 'core/pre-tool' },
);
