#!/usr/bin/env node
// stack-frontend / PostToolUse(Edit|Write|MultiEdit) — 규칙 경고 전달 + Stop 검증 대상 기록
import { runHook, pass as _pass, addContext } from '../lib/hook-io.mjs';
import { projectRoot, toolFilePath, resolveFile } from '../lib/config.mjs';
import { detectFrontend } from '../lib/build-detect.mjs';
import { updateSession } from '../lib/state.mjs';
import { takeWarnings } from '../lib/rules-hook.mjs';

await runHook(
  async (input) => {
    const extra = takeWarnings(input, 'frontend');
    const pass = () => (extra ? addContext('PostToolUse', extra) : _pass());
    const root = projectRoot(input);
    const f = toolFilePath(input.tool_input || {});
    if (!f) return pass();
    const p = detectFrontend(resolveFile(root, f), root);
    if (!p) return pass();
    updateSession(root, input.session_id, (s) => {
      s.dirty = s.dirty || {};
      const list = s.dirty.frontend || [];
      if (!list.some((x) => x.dir === p.dir && x.kind === p.kind)) list.push({ kind: p.kind, dir: p.dir });
      s.dirty.frontend = list;
      return s;
    });
    return pass();
  },
  { failClosed: false, name: 'stack-frontend/post-edit' },
);
