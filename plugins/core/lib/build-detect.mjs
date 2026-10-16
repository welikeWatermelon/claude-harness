// build-detect.mjs — 빌드 도구 감지
// Spring: gradlew → gradle(build.gradle) → mvnw → mvn(pom.xml) 순서 (사용자 결정: Gradle 우선, 없으면 Maven)
// React : lockfile 로 패키지 매니저 판별 (pnpm → yarn → bun → npm)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { IS_WIN } from './proc.mjs';

const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', 'out', 'target', 'bin', 'gradle', 'src']);
const GRADLE_FILES = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];

function has(dir, name) {
  return existsSync(path.join(dir, name));
}

/** start 에서 위로 올라가며 pred(dir) 가 참인 첫 디렉터리. stop(포함)까지만. */
export function findUp(start, pred, stop) {
  let dir = path.resolve(start);
  const end = stop ? path.resolve(stop) : path.parse(dir).root;
  for (;;) {
    if (pred(dir)) return dir;
    if (dir === end) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 파일이 속한 JVM 빌드 단위.
 * @returns {{tool:'gradle'|'maven', runner:string, runnerDir:string, moduleDir:string}|null}
 */
export function detectJvmBuild(fileOrDir, projectRoot) {
  const start = existsSync(fileOrDir) && !path.extname(fileOrDir) ? fileOrDir : path.dirname(fileOrDir);
  const moduleDir = findUp(start, (d) => GRADLE_FILES.some((f) => has(d, f)) || has(d, 'pom.xml'), projectRoot);
  if (!moduleDir) return null;
  const isGradle = GRADLE_FILES.some((f) => has(moduleDir, f));
  const isMaven = has(moduleDir, 'pom.xml');

  if (isGradle) {
    const wrapperName = IS_WIN ? 'gradlew.bat' : 'gradlew';
    const wDir = findUp(moduleDir, (d) => has(d, wrapperName) || has(d, 'gradlew'), projectRoot);
    if (wDir) {
      const runner = has(wDir, wrapperName) ? path.join(wDir, wrapperName) : path.join(wDir, 'gradlew');
      return { tool: 'gradle', runner, runnerDir: wDir, moduleDir };
    }
    return { tool: 'gradle', runner: IS_WIN ? 'gradle.bat' : 'gradle', runnerDir: moduleDir, moduleDir };
  }
  if (isMaven) {
    const wrapperName = IS_WIN ? 'mvnw.cmd' : 'mvnw';
    const wDir = findUp(moduleDir, (d) => has(d, wrapperName), projectRoot);
    if (wDir) return { tool: 'maven', runner: path.join(wDir, wrapperName), runnerDir: wDir, moduleDir };
    return { tool: 'maven', runner: IS_WIN ? 'mvn.cmd' : 'mvn', runnerDir: moduleDir, moduleDir };
  }
  return null;
}

/** compile / test 실행 인자 */
export function jvmArgs(b, goal) {
  const rel = path.relative(b.runnerDir, b.moduleDir);
  if (b.tool === 'gradle') {
    const tasks = goal === 'test' ? ['test'] : goal === 'compileAll' ? ['compileJava', 'compileTestJava'] : ['compileJava'];
    const proj = rel ? ['-p', b.moduleDir] : [];
    return ['-q', '--console=plain', ...proj, ...tasks];
  }
  const goals = goal === 'test' ? ['test'] : goal === 'compileAll' ? ['test-compile'] : ['compile'];
  return ['-q', '-B', '-f', path.join(b.moduleDir, 'pom.xml'), ...goals];
}

export function detectNodeProject(fileOrDir, projectRoot) {
  const start = existsSync(fileOrDir) && !path.extname(fileOrDir) ? fileOrDir : path.dirname(fileOrDir);
  const pkgDir = findUp(start, (d) => has(d, 'package.json'), projectRoot);
  if (!pkgDir) return null;
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch {}
  const lockDir = findUp(pkgDir, (d) => ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'package-lock.json'].some((f) => has(d, f)), projectRoot) || pkgDir;
  const pm = has(lockDir, 'pnpm-lock.yaml') ? 'pnpm' : has(lockDir, 'yarn.lock') ? 'yarn' : has(lockDir, 'bun.lockb') || has(lockDir, 'bun.lock') ? 'bun' : 'npm';
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return {
    pkgDir,
    pm,
    pmCmd: IS_WIN ? `${pm}.cmd` : pm,
    scripts: pkg.scripts || {},
    hasTs: !!deps.typescript && has(pkgDir, 'tsconfig.json'),
    isReact: !!deps.react,
  };
}

/** 프로젝트 루트에서 스택 감지 (/core:init 용) */
export function detectStacks(root) {
  const stacks = new Set();
  const walk = (dir, depth) => {
    if (depth > 2) return;
    if (GRADLE_FILES.some((f) => has(dir, f)) || has(dir, 'pom.xml')) stacks.add('spring');
    if (has(dir, 'package.json')) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps.react) stacks.add('react');
      } catch {}
    }
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return [...stacks];
}
