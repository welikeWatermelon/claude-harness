#!/usr/bin/env node
// stack-backend / PostToolUse(Edit|Write|MultiEdit)
//   1) 규칙 경고 전달
//   2) Python: 수정한 파일 문법 검사 (py_compile, 1초 내외) → 실패하면 바로 고치게
//   3) Stop 검증 대상 프로젝트 기록
import path from 'node:path';
import { runHook, pass as _pass, addContext, block } from '../lib/hook-io.mjs';
import { projectRoot, toolFilePath, resolveFile } from '../lib/config.mjs';
import { detectBackend } from '../lib/build-detect.mjs';
import { updateSession } from '../lib/state.mjs';
import { takeWarnings } from '../lib/rules-hook.mjs';
import { run, tail, IS_WIN } from '../lib/proc.mjs';

await runHook(
  async (input) => {
    const extra = takeWarnings(input, 'backend');
    const pass = () => (extra ? addContext('PostToolUse', extra) : _pass());
    const root = projectRoot(input);
    const f = toolFilePath(input.tool_input || {});
    if (!f) return pass();
    const abs = resolveFile(root, f);
    const b = detectBackend(abs, root);
    if (!b) return pass();
    updateSession(root, input.session_id, (s) => {
      s.dirty = s.dirty || {};
      const list = s.dirty.backend || [];
      if (!list.some((x) => x.dir === b.dir && x.kind === b.kind)) list.push({ kind: b.kind, dir: b.dir });
      s.dirty.backend = list;
      return s;
    });
    if (b.kind === 'python') {
      const r = run(IS_WIN ? 'python' : 'python3', ['-m', 'py_compile', abs], { cwd: b.dir, timeoutSec: 15 });
      if (!r.ok && !r.timedOut && /SyntaxError|IndentationError/.test(r.out)) {
        const msg = `[stack-backend] ${path.relative(root, abs)} 문법 오류예요. 바로 고치세요:\n${tail(r.out, 12)}`;
        return block(extra ? `${msg}\n\n${extra}` : msg);
      }
    }
    return pass();
  },
  { failClosed: false, name: 'stack-backend/post-edit' },
);
