#!/usr/bin/env node
// stack-frontend / Stop — 끝내기 전에 바꾼 프로젝트 검증
//   vue     : typecheck 스크립트 → vue-tsc --noEmit → lint 스크립트
//   nuxt    : typecheck 스크립트 → nuxi typecheck
//   android : Gradle <module>:compileDebugSources (frontend.androidTask)
//   ios     : macOS + Package.swift 면 swift build, 그 외(Windows 등)는 정적 규칙만 → 알림
import path from 'node:path';
import { existsSync } from 'node:fs';
import { runHook, block, systemMessage, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { detectNodeProject, detectJvmBuild } from '../lib/build-detect.mjs';
import { run, tail, whichCmd } from '../lib/proc.mjs';
import { loadSession, updateSession, getMode } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';

function steps(t, root, cfg) {
  if (t.kind === 'vue' || t.kind === 'nuxt') {
    const p = detectNodeProject(t.dir, root);
    if (!p) return [];
    const script = (n) => [p.pmCmd, p.pm === 'npm' ? ['run', n] : [n]];
    const exec = (...a) => [p.pmCmd, p.pm === 'npm' ? ['exec', '--', ...a] : p.pm === 'yarn' ? a : ['exec', ...a]];
    if (p.scripts.typecheck) return [script('typecheck')];
    if (t.kind === 'nuxt') return [exec('nuxi', 'typecheck')];
    if (p.deps['vue-tsc']) return [exec('vue-tsc', '--noEmit')];
    if (p.scripts.lint) return [script('lint')];
    return [];
  }
  if (t.kind === 'android') {
    const b = detectJvmBuild(t.dir, root);
    if (!b) return [];
    const rel = path.relative(b.runnerDir, b.moduleDir).replace(/[\\/]/g, ':');
    const task = (cfg.frontend && cfg.frontend.androidTask) || 'compileDebugSources';
    return [[b.runner, ['-q', '--console=plain', rel ? `:${rel}:${task}` : task], b.runnerDir]];
  }
  if (t.kind === 'ios') {
    if (process.platform === 'darwin' && existsSync(path.join(t.dir, 'Package.swift'))) return [[whichCmd('swift'), ['build']]];
    return null; // 검증 불가
  }
  return [];
}

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const sid = input.session_id;
    const conf = cfg.frontend || {};
    if (conf.verifyOnStop === 'off') return pass();
    if (getMode(root, cfg) === 'readonly') return pass();
    const s = loadSession(root, sid);
    const targets = (s.dirty && s.dirty.frontend) || [];
    if (!targets.length) return pass();

    const failures = [];
    const passed = [];
    const notes = [];
    for (const t of targets) {
      const label = `${path.relative(root, t.dir) || '.'} (${t.kind})`;
      const list = steps(t, root, cfg);
      if (list === null) {
        notes.push(`${label}: 이 OS 에서는 Swift 빌드를 할 수 없어 정적 규칙만 확인했어요 → Mac 에서 Xcode 빌드 확인이 필요해요`);
        continue;
      }
      let ok = true;
      for (const [cmd, args, cwd] of list) {
        const r = run(cmd, args, { cwd: cwd || t.dir, timeoutSec: conf.verifyTimeoutSec || 300 });
        logEvent(root, cfg, sid, 'verify', { target: label, goal: 'check', ok: r.ok, tool: path.basename(cmd), on: 'stop' });
        if (!r.ok) {
          ok = false;
          if (r.notFound) notes.push(`${label}: ${path.basename(cmd)} 없음, 검증 생략`);
          else failures.push(`■ ${label} (${path.basename(cmd)} ${args.join(' ')})\n${tail(r.out, 30)}`);
          break;
        }
      }
      if (ok && list.length) passed.push(label);
    }
    if (!failures.length) {
      updateSession(root, sid, (x) => {
        x.dirty.frontend = [];
        x.frontendStopBlocks = 0;
        return x;
      });
      const msg = [passed.length ? `✓ Frontend 검증 통과: ${passed.join(', ')}` : '', ...notes.map((n) => `ℹ ${n}`)].filter(Boolean).join('\n');
      return msg ? systemMessage(msg) : pass();
    }
    const count = (s.frontendStopBlocks || 0) + 1;
    const limit = cfg.stopLoopLimit || 3;
    if (count > limit) {
      updateSession(root, sid, (x) => {
        x.frontendStopBlocks = 0;
        return x;
      });
      return systemMessage(`⚠ Frontend 검증이 ${limit}회 연속 실패해서 넘겨요. 사람이 확인해주세요.\n${failures.join('\n\n').slice(0, 1500)}`);
    }
    updateSession(root, sid, (x) => {
      x.frontendStopBlocks = count;
      return x;
    });
    return block(`[stack-frontend] 끝내기 전에 검증이 실패했어요 (${count}/${limit}). 오류를 고친 뒤 마무리하세요.\n\n${failures.join('\n\n')}`);
  },
  { failClosed: false, name: 'stack-frontend/stop-verify' },
);
