#!/usr/bin/env node
// core / PostToolUse — 변경 이력 기록 + strict 모드 승인 토큰 발급
//   - Edit/Write/MultiEdit/NotebookEdit: 어떤 요청(프롬프트)으로 어떤 파일이 바뀌었는지 기록
//   - 변경성 Bash: 명령 기록
//   - ExitPlanMode 성공(= 사용자가 계획 수락): 이번 턴 승인 토큰 발급
import path from 'node:path';
import { runHook, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig, toolFilePath } from '../lib/config.mjs';
import { updateSession } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';
import { classify } from '../lib/bash-rules.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function countLines(ti) {
  const before = String(ti.old_string ?? '');
  const after = String(ti.new_string ?? ti.content ?? '');
  if (Array.isArray(ti.edits)) {
    let a = 0,
      r = 0;
    for (const e of ti.edits) {
      r += String(e.old_string || '').split('\n').length;
      a += String(e.new_string || '').split('\n').length;
    }
    return { added: a, removed: r };
  }
  return { added: after ? after.split('\n').length : 0, removed: before ? before.split('\n').length : 0 };
}

await runHook(
  async (input) => {
    const tool = input.tool_name || '';
    const ti = input.tool_input || {};
    const sid = input.session_id;
    const root = projectRoot(input);
    const cfg = loadConfig(root);

    if (tool === 'ExitPlanMode') {
      const plan = String(ti.plan || '');
      const s = updateSession(root, sid, (s) => {
        s.token = { approvedAt: new Date().toISOString(), summary: plan.split('\n').find((l) => l.trim()) || '' };
        return s;
      });
      logEvent(root, cfg, sid, 'plan_approved', { summary: s.token.summary.slice(0, 200), plan: plan.slice(0, 4000) });
      return pass();
    }

    if (EDIT_TOOLS.has(tool)) {
      const f = toolFilePath(ti);
      if (!f) return pass();
      const rel = path.relative(root, path.resolve(root, f)).replace(/\\/g, '/');
      const s = updateSession(root, sid, (s) => {
        if (!s.changedFiles.includes(rel)) s.changedFiles.push(rel);
        if (!s.turnFiles.includes(rel)) s.turnFiles.push(rel);
        return s;
      });
      logEvent(root, cfg, sid, 'file_change', { tool, file: rel, ...countLines(ti), prompt: (s.lastPrompt || '').slice(0, 200) });
      return pass();
    }

    if (tool === 'Bash' || tool === 'PowerShell') {
      const cmd = String(ti.command || '');
      const c = classify(cmd);
      if (c.mutating || c.categories.has('remote') || c.categories.has('db')) {
        logEvent(root, cfg, sid, 'command', { tool, command: cmd.slice(0, 500), cats: [...c.categories].join(',') });
      }
    }
    return pass();
  },
  { failClosed: false, name: 'core/post-tool' },
);
