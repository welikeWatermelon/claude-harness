#!/usr/bin/env node
// core / SessionStart
//   - main 자동 동기화 (fetch → 현재가 main 이면 ff-only, 아니면 로컬 main 포인터만 갱신)
//   - 현재 상태 요약 주입: 모드, 브랜치, 보호 브랜치 경고
//   - 인수인계 파일(HANDOFF/PROGRESS) 앞부분 주입 → 다른 노트북·새 세션에서 이어받기
//   - 컴팩션 직후(source=compact)면 직전 스냅샷 재주입
//   - 오래된 로그/상태 정리
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { runHook, addContext } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { git, isGitRepo, hasOrigin, currentBranch, defaultBranch, hasCommits } from '../lib/proc.mjs';
import { getMode, MODES, harnessDir, cleanup } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';
import { gateStatus } from '../lib/plan-gate.mjs';
import { openItems, DEFER_RULE } from '../lib/pending.mjs';

const HANDOFF_FILES = ['docs/HANDOFF.md', 'HANDOFF.md', 'PROGRESS.md', 'docs/PROGRESS.md'];

function syncMain(root, cfg) {
  if (!cfg.autoSyncMain || !isGitRepo(root) || !hasOrigin(root) || !hasCommits(root)) return null;
  const main = defaultBranch(root);
  if (!main) return null;
  const t = cfg.syncTimeoutSec || 10;
  const f = git(['fetch', '--quiet', 'origin', main], root, t);
  if (!f.ok) return `⚠ origin/${main} fetch 실패 (오프라인일 수 있어요)`;
  const cur = currentBranch(root);
  if (cur === main) {
    const dirty = git(['status', '--porcelain'], root).out.trim();
    if (dirty) return `ℹ ${main} 에 커밋 안 된 변경이 있어 pull 은 건너뛰었어요`;
    const r = git(['merge', '--ff-only', `origin/${main}`], root, t);
    return r.ok ? `✓ ${main} 최신화 완료` : `⚠ ${main} fast-forward 실패 — 로컬과 원격이 갈라졌어요`;
  }
  const r = git(['branch', '-f', main, `origin/${main}`], root, t);
  const behind = git(['rev-list', '--count', `HEAD..origin/${main}`], root).out.trim();
  const note = behind && behind !== '0' ? ` (현재 브랜치가 ${main} 보다 ${behind}커밋 뒤처짐 — 필요하면 rebase/merge)` : '';
  return r.ok ? `✓ 로컬 ${main} 포인터 갱신${note}` : `⚠ 로컬 ${main} 갱신 실패`;
}

function readHead(file, maxLines = 40) {
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const head = lines.slice(0, maxLines).join('\n');
    return lines.length > maxLines ? head + `\n… (${lines.length - maxLines}줄 더 있음: ${path.basename(file)})` : head;
  } catch {
    return null;
  }
}

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const source = input.source || 'startup';
    const mode = getMode(root, cfg);
    cleanup(root, cfg.log?.retentionDays ?? 30);

    const parts = [];
    const sync = source === 'startup' ? syncMain(root, cfg) : null;
    const branch = isGitRepo(root) ? currentBranch(root) : null;

    parts.push(`[하네스] 모드: ${mode} — ${MODES[mode]}${branch ? ` | 브랜치: ${branch}` : ''}${sync ? ` | ${sync}` : ''}`);
    if (branch && cfg.protectedBranches.includes(branch)) {
      parts.push(`⚠ 지금은 보호 브랜치(${branch})예요. 코드를 바꾸기 전에 \`git switch -c feature/<작업>\` 으로 브랜치를 먼저 만드세요.`);
    }
    const gate = gateStatus(root, mode);
    if (gate.active) {
      parts.push(
        `[계획 게이트 적용: ${gate.reason === 'team-member' ? `팀 설정에 따라 ${gate.who} 님` : 'strict 모드'}] 파일 수정 전 Plan 모드로 계획을 세우고 승인받아야 해요. 계획에 "## 변경 파일" 목록을 적으면 그 파일들은 승인 후 다음 메시지에서도 계속 수정할 수 있어요.`,
      );
    }
    parts.push(
      '규칙: 보호 브랜치 직접 수정·push 금지 / 시크릿 파일 읽기 금지 / 완료 조건(통과할 테스트)을 먼저 합의 / 같은 실수 2회면 docs/failures.md 기록 후 훅 승격 제안.',
    );

    if (cfg.deferQuestions) {
      parts.push(DEFER_RULE);
      const pend = openItems(root);
      if (pend.length) parts.push(`[미해결 결정 ${pend.length}건 — .harness/pending-decisions.md]\n${pend.map((i) => `- ${i.id}: ${i.title}`).join('\n')}\n사용자가 돌아왔으면 /workflow:decide 로 정리하자고 제안하세요.`);
    }

    if (source === 'compact') {
      const snap = readHead(path.join(harnessDir(root), 'compact-snapshot.md'), 60);
      if (snap) parts.push(`[컴팩션 전 스냅샷 — 이어서 작업]\n${snap}`);
    }
    if (source === 'startup' || source === 'resume') {
      for (const f of HANDOFF_FILES) {
        const abs = path.join(root, f);
        if (existsSync(abs)) {
          const head = readHead(abs, 40);
          if (head) parts.push(`[인수인계: ${f}]\n${head}`);
          break;
        }
      }
    }
    logEvent(root, cfg, input.session_id, 'session_start', { source, mode, branch, sync });
    addContext('SessionStart', parts.join('\n\n'));
  },
  { failClosed: false, name: 'core/session-start' },
);
