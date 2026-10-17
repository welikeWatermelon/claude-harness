#!/usr/bin/env node
// stack-backend / Stop — 끝내기 전에 바꾼 프로젝트 검증
//   backend.verifyOnStop: off | check | test
//     node   : typecheck 스크립트 → tsc --noEmit → lint 스크립트  (test: test 스크립트)
//     python : compileall (가상환경 제외) + ruff check(설치돼 있으면)  (test: pytest)
//     go     : go build ./... + go vet ./...  (test: go test ./...)
//     jvm    : Gradle classes testClasses / Maven test-compile  (test: test)
//   통과 후 B10: 소스만 바꾸고 테스트는 안 바꿨으면 프롬프트당 한 번 알림
import path from 'node:path';
import { runHook, block, systemMessage, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { detectNodeProject, detectJvmBuild, jvmArgs } from '../lib/build-detect.mjs';
import { run, tail, IS_WIN, whichCmd } from '../lib/proc.mjs';
import { loadSession, updateSession, getMode } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';
import { severityOf } from '../lib/code-rules.mjs';
import { sourceVsTests } from '../lib/rules-backend.mjs';

const PY = IS_WIN ? 'python' : 'python3';

function nodeSteps(dir, root, goal) {
  const p = detectNodeProject(dir, root);
  if (!p) return [];
  const script = (n) => [p.pmCmd, p.pm === 'npm' ? ['run', n] : [n]];
  const exec = (...a) => [p.pmCmd, p.pm === 'npm' ? ['exec', '--', ...a] : p.pm === 'yarn' ? a : ['exec', ...a]];
  const steps = [];
  if (p.scripts.typecheck) steps.push(script('typecheck'));
  else if (p.hasTs) steps.push(exec('tsc', '--noEmit'));
  else if (p.scripts.lint) steps.push(script('lint'));
  if (goal === 'test' && p.scripts.test) steps.push(script('test'));
  return steps;
}

function pythonSteps(dir, goal, changed) {
  const steps = [[PY, ['-m', 'compileall', '-q', '-x', '(\\.venv|venv|env|node_modules|\\.git|site-packages|__pycache__)', '.']]];
  const ruff = run(whichCmd('ruff'), ['--version'], { cwd: dir, timeoutSec: 10 });
  const files = changed.filter((f) => f.endsWith('.py'));
  if (ruff.ok && files.length) steps.push([whichCmd('ruff'), ['check', '--quiet', ...files]]);
  if (goal === 'test') steps.push([PY, ['-m', 'pytest', '-q', '-x']]);
  return steps;
}

function goSteps(goal) {
  const go = whichCmd('go');
  const steps = [
    [go, ['build', './...']],
    [go, ['vet', './...']],
  ];
  if (goal === 'test') steps.push([go, ['test', './...']]);
  return steps;
}

function jvmSteps(dir, root, goal) {
  const b = detectJvmBuild(dir, root);
  if (!b) return [];
  return [[b.runner, jvmArgs(b, goal === 'test' ? 'test' : 'compileAll'), b.runnerDir]];
}

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const sid = input.session_id;
    const conf = cfg.backend || {};
    if (conf.verifyOnStop === 'off') return pass();
    const mode = getMode(root, cfg);
    if (mode === 'readonly') return pass();
    const goal = conf.verifyOnStop === 'test' && mode !== 'night' ? 'test' : 'check';
    const s = loadSession(root, sid);
    const targets = (s.dirty && s.dirty.backend) || [];
    if (!targets.length) return pass();

    const failures = [];
    const passed = [];
    for (const t of targets) {
      const changed = (s.changedFiles || []).map((f) => path.join(root, f)).filter((f) => f.startsWith(t.dir)).map((f) => path.relative(t.dir, f));
      const steps = t.kind === 'node' ? nodeSteps(t.dir, root, goal) : t.kind === 'python' ? pythonSteps(t.dir, goal, changed) : t.kind === 'go' ? goSteps(goal) : jvmSteps(t.dir, root, goal);
      const label = `${path.relative(root, t.dir) || '.'} (${t.kind})`;
      let ok = true;
      for (const [cmd, args, cwd] of steps) {
        const r = run(cmd, args, { cwd: cwd || t.dir, timeoutSec: conf.verifyTimeoutSec || 300 });
        logEvent(root, cfg, sid, 'verify', { target: label, goal, ok: r.ok, tool: path.basename(cmd), on: 'stop' });
        if (!r.ok) {
          // 도구가 설치돼 있지 않은 경우(go·python 없음)는 실패로 보지 않고 알림만
          if (r.notFound || /No module named pytest/.test(r.out)) {
            passed.push(`${label} — ${path.basename(cmd)} 없음, 검증 생략`);
            ok = false;
            break;
          }
          failures.push(`■ ${label} (${path.basename(cmd)} ${args.join(' ')})\n${tail(r.out, 30)}`);
          ok = false;
          break;
        }
      }
      if (ok && steps.length) passed.push(label);
    }

    if (!failures.length) {
      updateSession(root, sid, (x) => {
        x.dirty.backend = [];
        x.backendStopBlocks = 0;
        return x;
      });
      const s2 = loadSession(root, sid);
      if (severityOf({ id: 'B10', severity: 'warn' }, cfg) !== 'off' && s2.backendTestNudgeTurn !== (s2.promptCount || 0)) {
        const { src, tests } = sourceVsTests(s2.changedFiles || []);
        if (src.length >= 1 && !tests.length) {
          updateSession(root, sid, (x) => {
            x.backendTestNudgeTurn = x.promptCount || 0;
            return x;
          });
          return block(
            `[B10] 이번 세션에서 ${src.slice(0, 5).map((f) => f.split('/').pop()).join(', ')}${src.length > 5 ? ` 외 ${src.length - 5}개` : ''} 를 바꿨는데 테스트는 하나도 바뀌지 않았어요.\n` +
              '완료 조건에 테스트가 있으면 작성·실행하고 결과를 보여주세요. 테스트가 필요 없는 변경이면 이유를 한 줄로 말하고 끝내세요.',
          );
        }
      }
      return passed.length ? systemMessage(`✓ Backend 검증 (${goal}): ${passed.join(', ')}`) : pass();
    }
    const count = (s.backendStopBlocks || 0) + 1;
    const limit = cfg.stopLoopLimit || 3;
    if (count > limit) {
      updateSession(root, sid, (x) => {
        x.backendStopBlocks = 0;
        return x;
      });
      return systemMessage(`⚠ Backend 검증이 ${limit}회 연속 실패해서 넘겨요. 사람이 확인해주세요.\n${failures.join('\n\n').slice(0, 1500)}`);
    }
    updateSession(root, sid, (x) => {
      x.backendStopBlocks = count;
      return x;
    });
    return block(`[stack-backend] 끝내기 전에 검증이 실패했어요 (${count}/${limit}). 오류를 고친 뒤 마무리하세요.\n\n${failures.join('\n\n')}`);
  },
  { failClosed: false, name: 'stack-backend/stop-verify' },
);
