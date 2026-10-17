#!/usr/bin/env node
// core / PreCompact — 컴팩션 직전에 "지금 하던 일"을 파일로 남깁니다.
// 사용자 CLAUDE.md 의 컴팩션 지침(수정 중이던 파일 목록 / 테스트 실행 명령 / 완료 조건 보존)을 훅으로 강제한 것.
// SessionStart(source=compact) 가 이 파일을 다시 읽어 주입합니다.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runHook } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { loadSession, harnessDir, getMode } from '../lib/state.mjs';
import { currentBranch } from '../lib/proc.mjs';
import { logEvent } from '../lib/logger.mjs';
import { openItems } from '../lib/pending.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const s = loadSession(root, input.session_id);
    let done = '';
    try {
      done = readFileSync(path.join(harnessDir(root), 'done-criteria.md'), 'utf8').trim();
    } catch {}
    const md = [
      `# 컴팩션 스냅샷 (${new Date().toLocaleString('ko-KR')})`,
      `- 모드: ${getMode(root, cfg)} / 브랜치: ${currentBranch(root) || '-'}`,
      '',
      '## 최근 요청',
      ...(s.prompts || []).map((p) => `- ${p.replace(/\s+/g, ' ').slice(0, 200)}`),
      '',
      '## 이번 세션에서 수정한 파일',
      ...(s.changedFiles.length ? s.changedFiles.map((f) => `- ${f}`) : ['- (없음)']),
      '',
      '## 완료 조건',
      done || '- (.harness/done-criteria.md 없음 — /workflow:done 으로 만들 수 있어요)',
      '',
      '## 미해결 결정 (.harness/pending-decisions.md)',
      ...(openItems(root).map((i) => `- ${i.id}: ${i.title}`).concat(openItems(root).length ? [] : ['- (없음)'])),
      '',
      '## 사용자 지시 (compact 시 입력한 내용)',
      input.custom_instructions || '- (없음)',
    ].join('\n');
    mkdirSync(harnessDir(root), { recursive: true });
    writeFileSync(path.join(harnessDir(root), 'compact-snapshot.md'), md, 'utf8');
    logEvent(root, cfg, input.session_id, 'pre_compact', { trigger: input.trigger, files: s.changedFiles.length });
  },
  { failClosed: false, name: 'core/pre-compact' },
);
