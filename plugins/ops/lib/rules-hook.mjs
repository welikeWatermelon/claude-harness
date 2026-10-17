// rules-hook.mjs — 코드 규칙을 훅에 연결
//   PreToolUse : 수정 결과를 미리 계산해 block 규칙 위반이면 거부, warn 위반은 세션에 보관
//   PostToolUse: 보관한 warn 위반을 Claude 에게 전달 (수정은 이미 반영됨 → 바로 고치게)
import path from 'node:path';
import { applyEdit, evaluate, readText, formatViolations } from './code-rules.mjs';
import { projectRoot, loadConfig, toolFilePath, resolveFile } from './config.mjs';
import { gitRoot } from './proc.mjs';
import { updateSession, loadSession } from './state.mjs';
import { logEvent } from './logger.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export function editContext(input) {
  const tool = input.tool_name || '';
  if (!EDIT_TOOLS.has(tool)) return null;
  const ti = input.tool_input || {};
  const f = toolFilePath(ti);
  if (!f) return null;
  const sessionRoot = projectRoot(input);
  const abs = resolveFile(sessionRoot, f);
  let root = sessionRoot;
  let rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    root = gitRoot(path.dirname(abs)) || path.dirname(abs);
    rel = path.relative(root, abs);
  }
  rel = rel.replace(/\\/g, '/');
  const cfg = loadConfig(root);
  const oldText = readText(abs);
  const newText = applyEdit(oldText, tool, ti);
  return { tool, ti, abs, rel, root, sessionRoot, cfg, oldText, newText, sessionId: input.session_id };
}

/** @returns {{blocks:[], warns:[]}|null} */
export function checkRules(ec, rules, key) {
  if (!ec || ec.newText === null) return null;
  const ctx = { root: ec.root, abs: ec.abs, cfg: ec.cfg };
  const list = evaluate(rules, { rel: ec.rel, oldText: ec.oldText, newText: ec.newText, ctx });
  const blocks = list.filter((v) => v.severity === 'block');
  const warns = list.filter((v) => v.severity === 'warn');
  for (const v of list) logEvent(ec.sessionRoot, ec.cfg, ec.sessionId, 'rule', { id: v.id, severity: v.severity, file: ec.rel, line: v.line });
  if (warns.length && !blocks.length) {
    updateSession(ec.sessionRoot, ec.sessionId, (s) => {
      s.pendingWarnings = s.pendingWarnings || {};
      s.pendingWarnings[key] = [...(s.pendingWarnings[key] || []), { rel: ec.rel, list: warns }];
      return s;
    });
  }
  return { blocks, warns };
}

export function blockMessage(ec, blocks) {
  return (
    `[하네스 규칙] 이 수정은 아래 규칙에 걸려서 적용하지 않았어요 (이 수정으로 새로 생기는 위반만 검사해요):\n${formatViolations(ec.rel, blocks)}\n` +
    `고쳐서 다시 수정하세요. 의도된 예외라면 사용자에게 알리고 .claude/harness.json 의 "rules": { "${blocks[0].id}": "warn" } 처럼 조정을 제안하세요.`
  );
}

/** PostToolUse: 보관된 warn 위반을 꺼내 메시지로 */
export function takeWarnings(input, key) {
  const root = projectRoot(input);
  const s = loadSession(root, input.session_id);
  const pend = (s.pendingWarnings && s.pendingWarnings[key]) || [];
  if (!pend.length) return null;
  updateSession(root, input.session_id, (x) => {
    if (x.pendingWarnings) delete x.pendingWarnings[key];
    return x;
  });
  return (
    '[하네스 규칙 경고] 방금 수정에서 새로 생긴 위반이에요. 이번 작업 범위라면 바로 고치고, 의도된 것이면 이유를 한 줄로 남기세요:\n' +
    pend.map((p) => formatViolations(p.rel, p.list)).join('\n')
  );
}
