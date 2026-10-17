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

// ---------- 계획 게이트 ----------
function teamConfig(dir, requiredFor, extra = {}) {
  mkdirSync(path.join(dir, '.claude'), { recursive: true });
  writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ planGate: { requiredFor, ...extra } }));
}
const edit = (dir, rel) => decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, rel), old_string: 'a', new_string: 'b' } }));
const write = (dir, rel) => decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, rel), content: 'x' } }));
const prompt = (dir, text) => hook('core', 'user-prompt.mjs', { cwd: dir, prompt: text });
const approve = (dir, plan) => hook('core', 'post-tool.mjs', { cwd: dir, tool_name: 'ExitPlanMode', tool_input: { plan }, tool_response: {} });
const PLAN = '# 환불 수정\n## 변경 파일\n- src/main/java/app/RefundService.java\n- `src/main/java/app/RefundController.java`\n## 위험\n- 없음\n';

function seedFiles(dir) {
  for (const f of ['src/main/java/app/RefundService.java', 'src/main/java/app/RefundController.java', 'src/main/java/app/OrderService.java']) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), 'class A {}\n');
  }
}

test('계획 게이트: 기본은 아무에게도 안 걸림 (본인·동등한 동료는 바로 수정)', () => {
  const dir = makeRepo({ branch: 'feature/peer' });
  seedFiles(dir);
  prompt(dir, '환불 고쳐줘');
  assert.equal(edit(dir, 'src/main/java/app/OrderService.java'), 'pass');
  assert.equal(prompt(dir, '로그인 기능 만들어줘').json, null, '모호한 요청 안내도 게이트 대상에게만');
});

test('계획 게이트: requiredFor 에 있는 팀원만 적용, 다른 동료는 미적용', () => {
  const dir = makeRepo({ branch: 'feature/team' });
  seedFiles(dir);
  teamConfig(dir, ['junior@team.com']);
  prompt(dir, '수정해줘');
  assert.equal(edit(dir, 'src/main/java/app/OrderService.java'), 'pass', 'git 사용자 t@t 는 대상 아님');
  sh('git', ['config', 'user.email', 'junior@team.com'], dir);
  assert.equal(edit(dir, 'src/main/java/app/OrderService.java'), 'deny');
  assert.match(prompt(dir, '로그인 기능 만들어줘').json.hookSpecificOutput.additionalContext, /계획 게이트/);
});

test('계획 게이트: 개인 harness.local.json 으로 requiredFor 를 비워도 빠지지 않음', () => {
  const dir = makeRepo({ branch: 'feature/local' });
  seedFiles(dir);
  teamConfig(dir, ['junior@team.com']);
  writeFileSync(path.join(dir, '.claude', 'harness.local.json'), JSON.stringify({ planGate: { requiredFor: [] } }));
  sh('git', ['config', 'user.email', 'junior@team.com'], dir);
  assert.equal(edit(dir, 'src/main/java/app/OrderService.java'), 'deny');
});

test('계획 게이트: 승인된 파일은 다음 메시지에서도 수정, 범위 밖은 차단, 새 계획이 범위를 대체', () => {
  const dir = makeRepo({ branch: 'feature/scope' });
  seedFiles(dir);
  teamConfig(dir, ['t@t']);
  prompt(dir, '환불 고쳐줘');
  approve(dir, PLAN);
  assert.equal(edit(dir, 'src/main/java/app/RefundService.java'), 'pass');
  prompt(dir, 'RefundService 오타도 고쳐줘');
  assert.equal(edit(dir, 'src/main/java/app/RefundService.java'), 'pass', '다음 메시지에서도 계획 파일은 허용');
  assert.equal(edit(dir, 'src/main/java/app/RefundController.java'), 'pass', '백틱으로 감싼 경로도 인식');
  assert.equal(edit(dir, 'src/main/java/app/OrderService.java'), 'deny', '계획 밖 기존 파일');
  assert.equal(write(dir, 'src/main/java/app/RefundPolicy.java'), 'pass', '계획 폴더 안 새 파일');
  assert.equal(write(dir, 'src/test/java/app/RefundServiceTest.java'), 'pass', '테스트 파일');
  assert.equal(write(dir, 'src/main/java/other/New.java'), 'deny', '계획 폴더 밖 새 파일');
  approve(dir, '## 변경 파일\n- src/main/java/app/OrderService.java\n');
  assert.equal(edit(dir, 'src/main/java/app/OrderService.java'), 'pass');
  assert.equal(edit(dir, 'src/main/java/app/RefundService.java'), 'deny', '새 계획이 이전 범위를 대체');
});

test('계획 게이트: 끝나는 시점 — /core:plan-done · 브랜치 변경 · 모드 변경 · 시간 만료 · 다른 세션', () => {
  const dir = makeRepo({ branch: 'feature/end' });
  seedFiles(dir);
  teamConfig(dir, ['t@t']);
  const F = 'src/main/java/app/RefundService.java';

  prompt(dir, 'go'); approve(dir, PLAN);
  assert.equal(prompt(dir, '/core:plan-done').json.hookSpecificOutput.additionalContext.includes('끝냈어요'), true);
  assert.equal(edit(dir, F), 'deny', 'plan-done');

  prompt(dir, 'go'); approve(dir, PLAN);
  sh('git', ['switch', '-qc', 'feature/other'], dir);
  assert.equal(edit(dir, F), 'deny', '브랜치 변경');
  sh('git', ['switch', '-q', 'feature/end'], dir);

  prompt(dir, 'go'); approve(dir, PLAN);
  prompt(dir, '/core:mode night');
  assert.equal(edit(dir, F), 'deny', '모드 변경 (night 이어도 팀원 게이트는 유지)');
  prompt(dir, '/core:mode standard');

  prompt(dir, 'go'); approve(dir, PLAN);
  const sf = path.join(dir, '.harness', 'state', 'test-session.json');
  const st = JSON.parse(readFileSync(sf, 'utf8'));
  st.token.approvedAt = new Date(Date.now() - 4 * 3600_000).toISOString();
  writeFileSync(sf, JSON.stringify(st));
  assert.equal(edit(dir, F), 'deny', '3시간 경과');

  prompt(dir, 'go'); approve(dir, PLAN);
  const other = decision(hook('core', 'pre-tool.mjs', { session_id: 'another', cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, F) } }));
  assert.equal(other, 'deny', '다른 세션');
});

test('계획 게이트: 계획에 변경 파일 목록이 없으면 승인한 메시지에서만 유효', () => {
  const dir = makeRepo({ branch: 'feature/turn' });
  seedFiles(dir);
  prompt(dir, '/core:mode strict');
  prompt(dir, 'go');
  approve(dir, '# 계획\n대충 고칠게요');
  assert.equal(edit(dir, 'src/main/java/app/OrderService.java'), 'pass');
  prompt(dir, '이어서');
  assert.equal(edit(dir, 'src/main/java/app/OrderService.java'), 'deny');
});

test('계획 게이트: 파일 바꾸는 셸 명령은 승인한 메시지 안에서만, git commit 은 게이트 대상 아님', () => {
  const dir = makeRepo({ branch: 'feature/bash' });
  seedFiles(dir);
  teamConfig(dir, ['t@t']);
  const bash = (c) => decision(hook('core', 'pre-tool.mjs', { cwd: dir, tool_name: 'Bash', tool_input: { command: c } }));
  prompt(dir, 'go');
  assert.equal(bash('rm src/main/java/app/OrderService.java'), 'deny');
  approve(dir, PLAN);
  assert.equal(bash('mv a b'), 'pass');
  prompt(dir, '다음');
  assert.equal(bash('mv a b'), 'deny');
  assert.equal(bash('git commit -m x'), 'pass');
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
