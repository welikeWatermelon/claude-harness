#!/usr/bin/env node
// core / PostToolUse — 변경 이력 기록 + strict 모드 승인 토큰 발급
//   - Edit/Write/MultiEdit/NotebookEdit: 어떤 요청(프롬프트)으로 어떤 파일이 바뀌었는지 기록
//   - 변경성 Bash: 명령 기록
//   - ExitPlanMode 성공(= 사용자가 계획 수락): 이번 턴 승인 토큰 발급
import path from 'node:path';
import { runHook, pass, addContext } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig, toolFilePath, resolveFile } from '../lib/config.mjs';
import { updateSession, getMode } from '../lib/state.mjs';
import { parsePlanScope, gateStatus } from '../lib/plan-gate.mjs';
import { currentBranch } from '../lib/proc.mjs';
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
      // ExitPlanMode 가 성공했다 = 사용자가 계획을 수락했다 (거절하면 도구가 실패해서 PostToolUse 가 오지 않음)
      const plan = String(ti.plan || '');
      const scope = parsePlanScope(plan, root);
      const useFiles = cfg.planGate.scope !== 'turn' && scope.files.length > 0;
      const s = updateSession(root, sid, (s) => {
        s.token = {
          approvedAt: new Date().toISOString(),
          summary: plan.split('\n').find((l) => l.trim()) || '',
          scope: useFiles ? 'files' : 'turn',
          files: scope.files,
          dirs: scope.dirs,
          branch: currentBranch(root),
          mode: getMode(root, cfg),
          turn: s.promptCount || 0,
        };
        return s;
      });
      logEvent(root, cfg, sid, 'plan_approved', { summary: s.token.summary.slice(0, 200), scope: s.token.scope, files: s.token.files, plan: plan.slice(0, 4000) });
      if (gateStatus(root, s.token.mode).active) {
        const msg = useFiles
          ? `[하네스] 계획 승인됨 — 다음 파일은 이후 메시지에서도 계속 수정할 수 있어요: ${scope.files.join(', ')}. 범위 밖 파일은 새 계획이 필요해요.`
          : '[하네스] 계획 승인됨 — 계획에 "## 변경 파일" 목록이 없어서 이번 메시지 안에서만 수정할 수 있어요.';
        return addContext('PostToolUse', msg);
      }
      return pass();
    }

    if (EDIT_TOOLS.has(tool)) {
      const f = toolFilePath(ti);
      if (!f) return pass();
      const rel = path.relative(root, resolveFile(root, f)).replace(/\\/g, '/');
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
      if (c.mutating) {
        updateSession(root, sid, (s) => {
          s.turnActed = true; // 이번 메시지에서 작업을 시작함 → 이후 질문은 미루기 대상
          return s;
        });
      }
      if (c.mutating || c.categories.has('remote') || c.categories.has('db')) {
        logEvent(root, cfg, sid, 'command', { tool, command: cmd.slice(0, 500), cats: [...c.categories].join(',') });
      }
    }
    return pass();
  },
  { failClosed: false, name: 'core/post-tool' },
);
