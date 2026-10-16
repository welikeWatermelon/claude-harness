// proc.mjs — 외부 명령 실행 + git 유틸
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const IS_WIN = process.platform === 'win32';

/**
 * 명령 실행. Windows 의 .bat/.cmd(gradlew.bat, mvnw.cmd, npm.cmd)는 shell 로 실행해야 해서 자동 처리합니다.
 * @returns {{ok:boolean, code:number|null, out:string, timedOut:boolean}}
 */
export function run(cmd, args = [], { cwd, timeoutSec = 10, env } = {}) {
  const needsShell = IS_WIN && /\.(bat|cmd)$/i.test(cmd);
  const quoted = needsShell ? args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  const r = spawnSync(needsShell ? `"${cmd}"` : cmd, quoted, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutSec * 1000,
    shell: needsShell,
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  return { ok: r.status === 0 && !r.error, code: r.status, out: timedOut ? `timed out after ${timeoutSec}s\n${out}` : out, timedOut };
}

export function tail(text, lines = 30) {
  const arr = String(text || '').split(/\r?\n/);
  return arr.slice(-lines).join('\n');
}

// ---------------- git ----------------

export function git(args, cwd, timeoutSec = 5) {
  return run('git', args, { cwd, timeoutSec });
}

export function isGitRepo(cwd) {
  return git(['rev-parse', '--git-dir'], cwd).ok;
}

export function gitRoot(cwd) {
  const r = git(['rev-parse', '--show-toplevel'], cwd);
  return r.ok ? path.resolve(r.out.split(/\r?\n/)[0]) : null;
}

/** 현재 브랜치. detached HEAD / 커밋 없는 새 레포 / git 아님 → null */
export function currentBranch(cwd) {
  const r = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  if (!r.ok) return null;
  return r.out.trim() || null;
}

export function hasCommits(cwd) {
  return git(['rev-parse', '--verify', 'HEAD'], cwd).ok;
}

export function hasOrigin(cwd) {
  return git(['remote', 'get-url', 'origin'], cwd).ok;
}

export function defaultBranch(cwd) {
  const r = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
  if (r.ok && r.out.startsWith('refs/remotes/origin/')) return r.out.trim().split('/').pop();
  for (const name of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', name], cwd).ok) return name;
  }
  return null;
}

export function stagedFiles(cwd) {
  const r = git(['diff', '--cached', '--name-only'], cwd);
  return r.ok ? r.out.split(/\r?\n/).filter(Boolean) : [];
}

export function stagedDiff(cwd) {
  const r = git(['diff', '--cached', '--unified=0', '--no-color'], cwd, 10);
  return r.ok ? r.out : '';
}

/** 파일이 git 작업 트리 안에 있는지 (root 기준 상대경로로 판단) */
export function isInside(root, file) {
  if (!root || !file) return false;
  const rel = path.relative(path.resolve(root), path.resolve(root, file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function exists(p) {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
