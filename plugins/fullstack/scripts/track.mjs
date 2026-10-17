#!/usr/bin/env node
// fullstack / PostToolUse — 백엔드에서 API 계약에 영향을 주는 파일(Controller·DTO·ErrorCode 등)을 고치면 표시
import path from 'node:path';
import { runHook, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig, toolFilePath } from '../lib/config.mjs';
import { updateSession } from '../lib/state.mjs';
import { API_FILE, fsCfg } from './contract.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const fs = fsCfg(loadConfig(root));
    if (fs.role !== 'backend') return pass();
    const f = toolFilePath(input.tool_input || {});
    if (!f || !API_FILE.test(path.resolve(root, f))) return pass();
    updateSession(root, input.session_id, (s) => {
      s.dirty = s.dirty || {};
      s.dirty.api = true;
      return s;
    });
    return pass();
  },
  { failClosed: false, name: 'fullstack/track' },
);
