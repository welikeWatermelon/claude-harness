#!/usr/bin/env node
// stack-react / Stop — 끝내기 전에 타입체크(기본)·린트·빌드 통과 강제
//   react.verifyOnStop: off | typecheck | lint | build
//   typecheck: tsconfig + typescript 가 있으면 `<pm> exec tsc --noEmit`, 없으면 lint 스크립트로 대체
import path from 'node:path';
import { runHook, block, systemMessage, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { detectNodeProject } from '../lib/build-detect.mjs';
import { run, tail } from '../lib/proc.mjs';
import { loadSession, updateSession, getMode } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';

function plan(p, goal) {
  const exec = p.pm === 'npm' ? ['exec', '--', 'tsc', '--noEmit'] : p.pm === 'yarn' ? ['tsc', '--noEmit'] : ['exec', 'tsc', '--noEmit'];
  const script = (name) => (p.pm === 'npm' ? ['run', name] : [name]);
  if (goal === 'build' && p.scripts.build) return script('build');
  if (goal === 'lint' && p.scripts.lint) return script('lint');
  if (goal === 'typecheck') {
    if (p.scripts.typecheck) return script('typecheck');
    if (p.hasTs) return exec;
    if (p.scripts.lint) return script('lint');
  }
  return null;
}

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const sid = input.session_id;
    const goal = cfg.react.verifyOnStop;
    if (goal === 'off') return pass();
    if (['readonly'].includes(getMode(root, cfg))) return pass();
    const s = loadSession(root, sid);
    const dirs = (s.dirty && s.dirty.react) || [];
    if (!dirs.length) return pass();

    const failures = [];
    const passed = [];
    for (const d of dirs) {
      const p = detectNodeProject(d, root);
      if (!p) continue;
      const args = plan(p, goal);
      if (!args) continue;
      const r = run(p.pmCmd, args, { cwd: p.pkgDir, timeoutSec: cfg.react.verifyTimeoutSec });
      const label = path.relative(root, p.pkgDir) || '.';
      logEvent(root, cfg, sid, 'verify', { target: label, goal, ok: r.ok, tool: p.pm, on: 'stop' });
      if (r.ok) passed.push(label);
      else failures.push(`■ ${label} (${p.pm} ${args.join(' ')})\n${tail(r.out, 30)}`);
    }
    if (!failures.length) {
      updateSession(root, sid, (x) => {
        x.dirty.react = [];
        x.reactStopBlocks = 0;
        return x;
      });
      return passed.length ? systemMessage(`✓ React 검증 통과 (${goal}): ${passed.join(', ')}`) : pass();
    }
    const count = (s.reactStopBlocks || 0) + 1;
    const limit = cfg.stopLoopLimit || 3;
    if (count > limit) {
      updateSession(root, sid, (x) => {
        x.reactStopBlocks = 0;
        return x;
      });
      return systemMessage(`⚠ React 검증이 ${limit}회 연속 실패해서 넘겨요. 사람이 확인해주세요.\n${failures.join('\n\n').slice(0, 1500)}`);
    }
    updateSession(root, sid, (x) => {
      x.reactStopBlocks = count;
      return x;
    });
    return block(`[stack-react] 끝내기 전에 ${goal} 검증이 실패했어요 (${count}/${limit}). 오류를 고친 뒤 마무리하세요.\n\n${failures.join('\n\n')}`);
  },
  { failClosed: false, name: 'stack-react/stop-verify' },
);
