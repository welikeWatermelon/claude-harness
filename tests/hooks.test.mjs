// 훅 스크립트 통합 테스트 — 실제 git 레포를 임시로 만들고, Claude Code 가 보내는 것과 같은 JSON 을 stdin 으로 넣어 실행합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (plugin, script) => path.join(REPO, 'plugins', plugin, 'scripts', script);

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function makeRepo({ branch = 'main' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-'));
  sh('git', ['init', '-q', '-b', 'main'], dir);
  sh('git', ['config', 'user.email', 't@t'], dir);
  sh('git', ['config', 'user.name', 't'], dir);
  writeFileSync(path.join(dir, 'README.md'), '# t\n');
  sh('git', ['add', '.'], dir);
  sh('git', ['commit', '-qm', 'init'], dir);
  if (branch !== 'main') sh('git', ['switch', '-qc', branch], dir);
  return dir;
}

function hook(plugin, script, input, env = {}) {
  const r = spawnSync('node', [P(plugin, script)], {
    input: JSON.stringify({ session_id: 'test-session', ...input }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 120000,
  });
  let json = null;
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}
const decision = (r) => r.json?.hookSpecificOutput?.permissionDecision || r.json?.decision || 'pass';

test('core: main 에서 Write 차단, 브랜치 생성은 통과, 새 브랜치에서 Write 허용', () => {
  const dir = makeRepo();
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'a.txt'), content: 'x' } })), 'deny');
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'git switch -c feature/a' } })), 'pass');
  sh('git', ['switch', '-qc', 'feature/a'], dir);
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'a.txt'), content: 'x' } })), 'pass');
});

test('core: main 에서 git commit 차단, 레포 밖 파일(예: ~/.claude/plans) 수정은 허용', () => {
  const dir = makeRepo();
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'git commit -am x' } })), 'deny');
  const outside = path.join(tmpdir(), 'plan.md');
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: outside, content: 'x' } })), 'pass');
});

test('core: 시크릿 스테이징 커밋 차단', () => {
  const dir = makeRepo({ branch: 'feature/s' });
  writeFileSync(path.join(dir, 'application.yml'), 'jwt:\n  secret: abcdefghijklmnop\n');
  sh('git', ['add', 'application.yml'], dir);
  const r = hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'git commit -m add' } });
  assert.equal(decision(r), 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /시크릿/);
  writeFileSync(path.join(dir, 'application.yml'), 'jwt:\n  secret: ${JWT_SECRET}\n');
  sh('git', ['add', 'application.yml'], dir);
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'git commit -m add' } })), 'pass');
});

test('core: 모드 전환은 사용자 프롬프트로만, night 모드 제한', () => {
  const dir = makeRepo({ branch: 'feature/n' });
  const r = hook('core', 'user-prompt.mjs', { cwd: dir, prompt: '/core:mode night' });
  assert.match(r.json.hookSpecificOutput.additionalContext, /night/);
  assert.equal(readFileSync(path.join(dir, '.harness', 'mode'), 'utf8').trim(), 'night');
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: './gradlew test' } })), 'deny');
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } })), 'deny');
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'x.java'), content: '' } })), 'pass');
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, '.harness', 'mode'), content: 'standard' } })), 'deny');
  assert.equal(decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, '.harness', 'done-criteria.md'), content: '- [ ] t' } })), 'pass');
});

test('core: strict 모드 — 계획 승인 전 차단, ExitPlanMode 후 허용, 다음 프롬프트에서 다시 차단', () => {
  const dir = makeRepo({ branch: 'feature/st' });
  hook('core', 'user-prompt.mjs', { cwd: dir, prompt: '/core:mode strict' });
  const write = () => decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'README.md'), old_string: 't', new_string: 'u' } }));
  hook('core', 'user-prompt.mjs', { cwd: dir, prompt: 'README 고쳐줘' });
  assert.equal(write(), 'deny');
  hook('core', 'post-tool.mjs', { cwd: dir, tool_name: 'ExitPlanMode', tool_input: { plan: '## 변경\nREADME.md :: 제목 변경' }, tool_response: {} });
  assert.equal(write(), 'pass');
  hook('core', 'stop.mjs', { cwd: dir });
  assert.equal(write(), 'pass', 'Stop 에서는 토큰을 지우지 않음 (다른 Stop 훅이 block 해서 턴이 이어질 수 있음)');
  hook('core', 'user-prompt.mjs', { cwd: dir, prompt: '다른 것도 바꿔줘' });
  assert.equal(write(), 'deny');
});

test('core: 모호한 요청엔 Plan 안내 주입, 구체적 요청엔 없음', () => {
  const dir = makeRepo({ branch: 'feature/v' });
  assert.match(hook('core', 'user-prompt.mjs', { cwd: dir, prompt: '로그인 기능 만들어줘' }).json.hookSpecificOutput.additionalContext, /Plan/);
  assert.equal(hook('core', 'user-prompt.mjs', { cwd: dir, prompt: 'AuthService.java 의 login 에서 null 체크 추가해줘' }).json, null);
});

test('core: 변경 이력 — 어떤 요청으로 어떤 파일이 바뀌었는지 기록', () => {
  const dir = makeRepo({ branch: 'feature/log' });
  hook('core', 'user-prompt.mjs', { cwd: dir, prompt: 'README 에 설치 방법 추가해줘' });
  hook('core', 'post-tool.mjs', { cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'README.md'), old_string: '# t', new_string: '# t\n## 설치' } });
  const logDir = path.join(dir, '.harness', 'logs');
  const lines = readFileSync(path.join(logDir, readdirSync(logDir).find((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))), 'utf8').trim().split('\n').map(JSON.parse);
  const change = lines.find((e) => e.type === 'file_change');
  assert.equal(change.file, 'README.md');
  assert.match(change.prompt, /설치 방법/);
});

test('core: SessionStart 컨텍스트 — 모드·보호 브랜치 경고·HANDOFF 주입', () => {
  const dir = makeRepo();
  mkdirSync(path.join(dir, 'docs'));
  writeFileSync(path.join(dir, 'docs', 'HANDOFF.md'), '# HANDOFF\n## 다음에 할 일\n1. 결제 환불 테스트\n');
  const r = hook('core', 'session-start.mjs', { cwd: dir, source: 'startup' });
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /모드: standard/);
  assert.match(ctx, /보호 브랜치\(main\)/);
  assert.match(ctx, /결제 환불 테스트/);
});

test('core: PreCompact 스냅샷 → SessionStart(compact) 재주입', () => {
  const dir = makeRepo({ branch: 'feature/c' });
  hook('core', 'user-prompt.mjs', { cwd: dir, prompt: '환불 Saga 구현 이어서 해줘' });
  hook('core', 'post-tool.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'RefundSaga.java'), content: 'class A{}' } });
  hook('core', 'pre-compact.mjs', { cwd: dir, trigger: 'auto' });
  const ctx = hook('core', 'session-start.mjs', { cwd: dir, source: 'compact' }).json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /RefundSaga\.java/);
  assert.match(ctx, /환불 Saga/);
});

test('core: cli init — settings.json 병합·gitignore·기록 파일', () => {
  const dir = makeRepo({ branch: 'chore/init' });
  mkdirSync(path.join(dir, '.claude'));
  writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(echo:*)'] } }));
  writeFileSync(path.join(dir, 'build.gradle'), "plugins { id 'java' }\n");
  const r = spawnSync('node', [P('core', 'cli.mjs'), 'init', '--apply'], { cwd: dir, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.stacks, ['spring']);
  const sp = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.ok(sp.enabledPlugins['core@yj-harness']);
  assert.ok(sp.enabledPlugins['stack-spring@yj-harness']);
  assert.ok(!sp.enabledPlugins['stack-react@yj-harness']);
  assert.ok(sp.permissions.allow.includes('Bash(echo:*)'), '기존 allow 유지');
  assert.match(readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.harness\//);
  assert.ok(existsSync(path.join(dir, 'docs', 'failures.md')));
});

test('stack-spring: 적용된 Flyway 마이그레이션 수정 차단, 새 파일은 허용', () => {
  const dir = makeRepo({ branch: 'feature/m' });
  const mig = path.join(dir, 'src/main/resources/db/migration');
  mkdirSync(mig, { recursive: true });
  writeFileSync(path.join(mig, 'V1__init.sql'), 'create table a(id int);');
  assert.equal(decision(hook('stack-spring', 'pre-edit.mjs', { cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(mig, 'V1__init.sql') } })), 'deny');
  assert.equal(decision(hook('stack-spring', 'pre-edit.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(mig, 'V2__add.sql') } })), 'pass');
});

test('stack-spring: application.yml 하드코딩 시크릿 경고', () => {
  const dir = makeRepo({ branch: 'feature/y' });
  const f = path.join(dir, 'src/main/resources/application.yml');
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, 'spring:\n  datasource:\n    password: realpassword123\n    url: ${DB_URL}\n');
  const r = hook('stack-spring', 'post-edit.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: f } });
  assert.match(r.json.hookSpecificOutput.additionalContext, /password/);
  assert.doesNotMatch(r.json.hookSpecificOutput.additionalContext, /realpassword123/);
});

const hasGradle = spawnSync('gradle', ['--version'], { encoding: 'utf8' }).status === 0;
test('stack-spring: 편집 시 컴파일 실패를 Claude 에게 돌려주고, Stop 에서 block → 고치면 통과', { skip: !hasGradle && 'gradle 없음', timeout: 300000 }, () => {
  const dir = makeRepo({ branch: 'feature/g' });
  writeFileSync(path.join(dir, 'settings.gradle'), "rootProject.name = 'demo'\n");
  writeFileSync(path.join(dir, 'build.gradle'), "plugins { id 'java' }\n");
  const src = path.join(dir, 'src/main/java/demo/App.java');
  mkdirSync(path.dirname(src), { recursive: true });
  writeFileSync(src, 'package demo; public class App { int x = "string"; }\n');
  const r1 = hook('stack-spring', 'post-edit.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: src } });
  assert.equal(r1.json?.decision, 'block', r1.out + r1.err);
  assert.match(r1.json.reason, /컴파일 실패/);
  const s1 = hook('stack-spring', 'stop-verify.mjs', { cwd: dir });
  assert.equal(s1.json?.decision, 'block');
  writeFileSync(src, 'package demo; public class App { int x = 1; }\n');
  const s2 = hook('stack-spring', 'stop-verify.mjs', { cwd: dir });
  assert.match(s2.json?.systemMessage || '', /통과/);
});

test('ops: 원격 파괴 명령 차단, 일반 원격 명령은 감사 로그만', () => {
  const dir = makeRepo({ branch: 'feature/o' });
  assert.equal(decision(hook('ops', 'remote-guard.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'ssh ec2-user@10.0.0.1 "docker compose down"' } })), 'deny');
  assert.equal(decision(hook('ops', 'remote-guard.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'ssh ec2-user@prod-api "docker logs app"' } })), 'ask');
  assert.equal(decision(hook('ops', 'remote-guard.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'ssh ec2-user@10.0.0.1 "docker logs app"' } })), 'pass');
  const month = new Date().toISOString().slice(0, 7);
  const audit = readFileSync(path.join(dir, '.harness', 'logs', `ops-${month}.jsonl`), 'utf8');
  assert.match(audit, /docker logs app/);
  assert.match(audit, /remote-destructive/);
});
