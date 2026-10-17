// proc.mjs — 외부 명령 실행 + git 유틸
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const IS_WIN = process.platform === 'win32';

/**
 * 명령 실행. Windows 의 .bat/.cmd(gradlew.bat, mvnw.cmd, npm.cmd)는 shell 로 실행해야 해서 자동 처리합니다.
 * @returns {{ok:boolean, code:number|null, out:string, timedOut:boolean, notFound:boolean}}
 */
export function run(cmd, args = [], { cwd, timeoutSec = 10, env } = {}) {
  const opts = {
    cwd,
    encoding: 'utf8',
    timeout: timeoutSec * 1000,
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 16 * 1024 * 1024,
  };
  let r;
  if (IS_WIN && /\.(bat|cmd)$/i.test(cmd)) {
    // .bat/.cmd 는 cmd.exe 로만 실행 가능. Node 의 shell:true 는 따옴표를 다시 이스케이프해서
    // '"gradle.bat"' is not recognized 오류가 났음 (Windows CI 에서 확인) → cmd.exe 를 직접, 인자를 그대로 전달
    const q = (a) => (/[\s"&|<>^()]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);
    const line = [q(cmd), ...args.map(q)].join(' ');
    r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
  } else {
    r = spawnSync(cmd, args, opts);
  }
  let out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  // 명령이 설치돼 있지 않음 (Windows .cmd 경유는 'is not recognized' 로 나옴)
  const notFound = (r.error && r.error.code === 'ENOENT') || (IS_WIN && r.status === 9009) || /is not recognized as an internal or external command/.test(out);
  if (notFound && !out) out = `ENOENT: ${cmd} 를 찾을 수 없어요`;
  return { ok: r.status === 0 && !r.error, code: r.status, out: timedOut ? `timed out after ${timeoutSec}s\n${out}` : out, timedOut, notFound };
}

/**
 * 경로 정규화: 절대경로 + 실제 경로(가장 가까운 존재하는 상위 폴더 기준 realpath).
 * Windows 는 같은 폴더를 8.3 짧은 이름(C:\Users\RUNNER~1)과 긴 이름으로 부를 수 있고,
 * git 은 긴 이름을 돌려줘서 "레포 안 파일"을 레포 밖으로 잘못 판단했음 (Windows CI 에서 확인).
 */
export function canon(p) {
  if (!p) return p;
  let abs = path.resolve(p);
  const rest = [];
  let cur = abs;
  for (;;) {
    if (existsSync(cur)) {
      try {
        cur = realpathSync.native(cur);
      } catch {}
      break;
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    rest.unshift(path.basename(cur));
    cur = up;
  }
  abs = rest.length ? path.join(cur, ...rest) : cur;
  return abs;
}

/**
 * PATH 에 있는 명령의 실제 실행 파일. Windows 는 설치 방법에 따라 gradle.bat / gradle.exe(choco shim) / gradle.cmd 가
 * 달라서 이름을 가정하면 안 됨 (Windows CI 에서 'gradle.bat' is not recognized 로 확인) → `where` 로 찾음.
 * 못 찾으면 name 그대로.
 */
export function whichCmd(name) {
  if (!IS_WIN) return name;
  const r = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const found = (r.stdout || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const pick = found.find((f) => /\.(exe|bat|cmd)$/i.test(f));
  return pick || name;
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
  return r.ok ? canon(r.out.split(/\r?\n/)[0]) : null;
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
  const rel = path.relative(canon(root), canon(path.resolve(root, file)));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function exists(p) {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
