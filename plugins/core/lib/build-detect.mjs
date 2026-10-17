// build-detect.mjs — 빌드 도구 감지
// Spring: gradlew → gradle(build.gradle) → mvnw → mvn(pom.xml) 순서 (사용자 결정: Gradle 우선, 없으면 Maven)
// React : lockfile 로 패키지 매니저 판별 (pnpm → yarn → bun → npm)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { IS_WIN, whichCmd } from './proc.mjs';

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
    return { tool: 'gradle', runner: whichCmd('gradle'), runnerDir: moduleDir, moduleDir };
  }
  if (isMaven) {
    const wrapperName = IS_WIN ? 'mvnw.cmd' : 'mvnw';
    const wDir = findUp(moduleDir, (d) => has(d, wrapperName), projectRoot);
    if (wDir) return { tool: 'maven', runner: path.join(wDir, wrapperName), runnerDir: wDir, moduleDir };
    return { tool: 'maven', runner: whichCmd('mvn'), runnerDir: moduleDir, moduleDir };
  }
  return null;
}

/** compile / test 실행 인자 */
export function jvmArgs(b, goal, _file) {
  const rel = path.relative(b.runnerDir, b.moduleDir);
  if (b.tool === 'gradle') {
    // classes/testClasses 는 Java·Kotlin 컴파일을 모두 포함 (compileJava 만 돌리면 .kt 변경을 못 잡음)
    const tasks = goal === 'test' ? ['test'] : goal === 'compileAll' ? ['classes', 'testClasses'] : ['classes'];
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
    deps,
  };
}

const NODE_BACKEND = ['express', '@nestjs/core', 'fastify', 'koa', 'hono', '@hapi/hapi', '@adonisjs/core'];
const PY_FILES = ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'manage.py'];

function readSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

export function jvmFlavor(dir) {
  const text = ['build.gradle', 'build.gradle.kts', 'pom.xml'].map((f) => readSafe(path.join(dir, f))).join('\n');
  if (!text.trim()) return null;
  if (/com\.android\.(application|library)|id\s*\(?\s*["']com\.android|android\s*\{/.test(text)) return 'android';
  if (/springframework/.test(text)) return 'spring';
  return 'jvm';
}

/** 디렉터리 하나의 스택 표시들 */
function stacksIn(dir) {
  const out = new Set();
  const flavor = jvmFlavor(dir);
  if (flavor === 'spring') out.add('spring');
  else if (flavor === 'android') out.add('frontend');
  else if (flavor === 'jvm') out.add('jvm-only'); // Spring·Android 멀티모듈의 하위 모듈일 수 있어 최종 판단은 detectStacks 에서
  if (has(dir, 'package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.react && !deps['react-native']) out.add('react');
      if (deps.vue || deps.nuxt) out.add('frontend');
      if (NODE_BACKEND.some((d) => deps[d])) out.add('backend');
    } catch {}
  }
  if (PY_FILES.some((f) => has(dir, f))) out.add('backend');
  if (has(dir, 'go.mod')) out.add('backend');
  if (has(dir, 'Package.swift') || has(dir, 'Podfile')) out.add('frontend');
  try {
    if (readdirSync(dir).some((n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace'))) out.add('frontend');
  } catch {}
  return out;
}

/**
 * 파일이 속한 백엔드 프로젝트 (Spring 이 아닌 것)
 * @returns {{kind:'node'|'python'|'go'|'jvm', dir:string, node?:object, jvm?:object}|null}
 */
export function detectBackend(fileOrDir, projectRoot) {
  const start = existsSync(fileOrDir) && !path.extname(fileOrDir) ? fileOrDir : path.dirname(fileOrDir);
  const ext = path.extname(fileOrDir).toLowerCase();
  if (ext === '.go') {
    const dir = findUp(start, (d) => has(d, 'go.mod'), projectRoot);
    return dir ? { kind: 'go', dir } : null;
  }
  if (ext === '.py') {
    const dir = findUp(start, (d) => PY_FILES.some((f) => has(d, f)), projectRoot);
    return { kind: 'python', dir: dir || path.resolve(projectRoot || start) };
  }
  if (['.java', '.kt', '.kts'].includes(ext)) {
    const b = detectJvmBuild(fileOrDir, projectRoot);
    if (!b) return null;
    const fl = jvmFlavor(b.moduleDir) || jvmFlavor(b.runnerDir);
    if (fl === 'spring' || fl === 'android') return null;
    return { kind: 'jvm', dir: b.moduleDir, jvm: b };
  }
  if (/\.(ts|js|mjs|cjs|mts|cts)$/.test(ext)) {
    const p = detectNodeProject(fileOrDir, projectRoot);
    if (!p || !NODE_BACKEND.some((d) => p.deps[d])) return null;
    return { kind: 'node', dir: p.pkgDir, node: p };
  }
  return null;
}

/**
 * 파일이 속한 프론트(React 제외) 프로젝트
 * @returns {{kind:'vue'|'nuxt'|'android'|'ios', dir:string, node?:object, jvm?:object}|null}
 */
export function detectFrontend(fileOrDir, projectRoot) {
  const start = existsSync(fileOrDir) && !path.extname(fileOrDir) ? fileOrDir : path.dirname(fileOrDir);
  const ext = path.extname(fileOrDir).toLowerCase();
  if (ext === '.swift') {
    const dir = findUp(start, (d) => has(d, 'Package.swift') || readdirSafe(d).some((n) => n.endsWith('.xcodeproj')), projectRoot);
    return { kind: 'ios', dir: dir || path.resolve(projectRoot || start) };
  }
  if (['.kt', '.java', '.xml'].includes(ext)) {
    const b = detectJvmBuild(fileOrDir, projectRoot);
    if (!b || (jvmFlavor(b.moduleDir) !== 'android' && jvmFlavor(b.runnerDir) !== 'android')) return null;
    return { kind: 'android', dir: b.moduleDir, jvm: b };
  }
  if (/\.(vue|ts|js|mjs|tsx|jsx)$/.test(ext)) {
    const p = detectNodeProject(fileOrDir, projectRoot);
    if (!p) return null;
    if (p.deps.nuxt) return { kind: 'nuxt', dir: p.pkgDir, node: p };
    if (p.deps.vue) return { kind: 'vue', dir: p.pkgDir, node: p };
  }
  return null;
}

function readdirSafe(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}

/** 프로젝트 루트에서 스택 감지 (/core:init 용) → spring | react | backend | frontend */
export function detectStacks(root) {
  const stacks = new Set();
  const walk = (dir, depth) => {
    if (depth > 2) return;
    for (const s of stacksIn(dir)) stacks.add(s);
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && !e.name.endsWith('.xcodeproj')) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  if (stacks.has('jvm-only')) {
    stacks.delete('jvm-only');
    if (!stacks.has('spring') && !(stacks.has('frontend') && hasAndroid(root))) stacks.add('backend');
  }
  return [...stacks];
}

function hasAndroid(root) {
  return jvmFlavor(root) === 'android' || readdirSafe(root).some((n) => jvmFlavor(path.join(root, n)) === 'android');
}
