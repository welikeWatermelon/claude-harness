#!/usr/bin/env node
// stack-react / PostToolUse(Edit|Write|MultiEdit)
//   1) R1: 수정한 파일에 eslint --fix → 자동으로 못 고친 오류만 Claude 에게 (출력은 잘라서)
//   2) PreToolUse 에서 보관한 규칙 경고(R4·R6·R8 등) 전달
//   3) Stop 검증 대상 package.json 위치 기록
import path from 'node:path';
import { runHook, pass as _pass, addContext as _addContext, block } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig, toolFilePath, resolveFile } from '../lib/config.mjs';
import { detectNodeProject } from '../lib/build-detect.mjs';
import { updateSession } from '../lib/state.mjs';
import { takeWarnings } from '../lib/rules-hook.mjs';
import { severityOf } from '../lib/code-rules.mjs';
import { run, tail, exists } from '../lib/proc.mjs';
import { logEvent } from '../lib/logger.mjs';

const ESLINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml'];

function eslintArgs(p, file) {
  const base = ['eslint', '--fix', '--no-warn-ignored', '--format', 'unix', file];
  if (p.pm === 'npm') return ['exec', '--', ...base];
  if (p.pm === 'yarn') return base;
  return ['exec', ...base];
}

await runHook(
  async (input) => {
    const extra = takeWarnings(input, 'react');
    const pass = () => (extra ? _addContext('PostToolUse', extra) : _pass());
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const f = toolFilePath(input.tool_input || {});
    if (!f || !/\.(tsx?|jsx?|mjs|cjs|vue|css|scss)$/i.test(f)) return pass();
    const abs = resolveFile(root, f);
    const p = detectNodeProject(abs, root);
    if (!p) return pass();
    updateSession(root, input.session_id, (s) => {
      s.dirty = s.dirty || {};
      const set = new Set(s.dirty.react || []);
      set.add(p.pkgDir);
      s.dirty.react = [...set];
      return s;
    });

    // R1: eslint --fix (eslint 가 의존성에 있고 설정 파일이 있을 때만)
    if (cfg.react.eslintFixOnEdit && severityOf({ id: 'R1', severity: 'warn' }, cfg) !== 'off' && /\.(tsx?|jsx?|mjs|cjs|vue)$/i.test(abs)) {
      const hasEslint = p.deps && p.deps.eslint;
      const hasCfg = ESLINT_CONFIGS.some((c) => exists(path.join(p.pkgDir, c)));
      if (hasEslint && hasCfg) {
        const rel = path.relative(p.pkgDir, abs);
        const r = run(p.pmCmd, eslintArgs(p, rel), { cwd: p.pkgDir, timeoutSec: cfg.react.eslintTimeoutSec });
        logEvent(root, cfg, input.session_id, 'verify', { target: rel, goal: 'eslint', ok: r.ok, tool: p.pm, on: 'edit' });
        if (!r.ok && !r.timedOut && /:\d+:\d+:/.test(r.out || '')) {
          const lines = String(r.out)
            .split(/\r?\n/)
            .filter((l) => /:\d+:\d+:/.test(l))
            .slice(0, 20)
            .map((l) => '  ' + l.replace(p.pkgDir, '').replace(/^[\\/]/, ''));
          const msg = `[R1] eslint --fix 를 돌렸는데 자동으로 못 고친 문제가 남았어요 (${rel}). 고쳐주세요 — eslint-disable 로 숨기지 말고요:\n${lines.join('\n')}`;
          return block(extra ? `${msg}\n\n${extra}` : msg);
        }
      }
    }
    return pass();
  },
  { failClosed: false, name: 'stack-react/track' },
);
