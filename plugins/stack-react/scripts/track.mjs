#!/usr/bin/env node
// stack-react / PostToolUse — 바뀐 TS/JS 파일이 속한 package.json 위치를 기록 (Stop 검증 대상)
import path from 'node:path';
import { runHook, pass } from '../lib/hook-io.mjs';
import { projectRoot, toolFilePath, resolveFile } from '../lib/config.mjs';
import { detectNodeProject } from '../lib/build-detect.mjs';
import { updateSession } from '../lib/state.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const f = toolFilePath(input.tool_input || {});
    if (!f || !/\.(tsx?|jsx?|mjs|cjs|vue|css|scss)$/i.test(f)) return pass();
    const p = detectNodeProject(resolveFile(root, f), root);
    if (!p) return pass();
    updateSession(root, input.session_id, (s) => {
      s.dirty = s.dirty || {};
      const set = new Set(s.dirty.react || []);
      set.add(p.pkgDir);
      s.dirty.react = [...set];
      return s;
    });
    return pass();
  },
  { failClosed: false, name: 'stack-react/track' },
);
