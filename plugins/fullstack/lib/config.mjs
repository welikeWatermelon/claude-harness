// config.mjs — 프로젝트별 하네스 설정 로드
//   <project>/.claude/harness.json        팀 공용 (git 커밋)
//   <project>/.claude/harness.local.json  개인용 (git 제외) — 위 값을 덮어씀
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gitRoot, canon } from './proc.mjs';

export const DEFAULTS = {
  protectedBranches: ['main', 'master', 'develop'],
  // 보호 브랜치 위에서도 수정 허용할 경로(glob 비슷한 접두사). 예: ["docs/"]
  protectedBranchAllowPaths: [],
  defaultMode: 'standard', // standard | strict | night | readonly | ops
  autoSyncMain: true,
  syncTimeoutSec: 10,
  vaguePromptNudge: 'gated', // gated: 계획 게이트 대상(팀원/strict)에게만 | always | off
  log: { enabled: true, retentionDays: 30, redact: true },
  secrets: {
    // Read/Bash 로 읽기 금지할 파일 패턴 (정규식, 경로 끝부분과 매칭)
    readDeny: [
      '(^|[\\\\/])\\.env(\\.(?!example$|sample$|template$)[^\\\\/]+)?$',
      '\\.(pem|key|p12|pfx|jks|keystore)$',
      '(^|[\\\\/])id_(rsa|ed25519|ecdsa)(\\.pub)?$',
      'application-prod\\.(ya?ml|properties)$',
      '(^|[\\\\/])credentials(\\.json)?$',
      '(^|[\\\\/])\\.mcp\\.json$',
      '(^|[\\\\/])backend\\.env$',
    ],
    readAllow: [],
  },
  spring: {
    compileOnEdit: true,
    compileTimeoutSec: 120,
    verifyOnStop: 'compile', // off | compile | test
    verifyTimeoutSec: 600,
    blockEditingAppliedMigrations: true,
  },
  react: {
    verifyOnStop: 'typecheck', // off | typecheck | lint | build
    verifyTimeoutSec: 300,
  },
  ops: {
    allowedHosts: [], // 비어 있으면 호스트 제한 없음(로그만)
    prodKeywords: ['prod', 'production', 'live'],
  },
  // 계획 승인 게이트 — 기본은 아무에게도 걸지 않음. requiredFor 에 있는 팀원만 자동 적용 (팀 공용 harness.json 에서만 읽음)
  planGate: {
    requiredFor: [], // git user.email 또는 user.name 목록
    scope: 'files', // files: 계획에 적힌 파일은 다음 메시지에서도 계속 수정 가능 | turn: 승인한 턴에서만
    ttlHours: 3,
    allowNewFilesInPlannedDirs: true,
    allowTestFiles: true,
  },
  // 결정 미루기: 작업을 시작한 뒤에는 중간 질문(AskUserQuestion)을 막고 대기 목록에 적게 함 → 끝날 때 한 번에 질문
  deferQuestions: true,
  // fullstack 플러그인 (백엔드·프론트 레포가 분리된 경우)
  fullstack: {
    role: null, // 'backend' | 'frontend'
    peerPath: null, // 상대 레포 경로 (예: "../holssi_front")
    backendModule: '.', // 멀티모듈이면 API 모듈 경로
    openapi: {
      gradleTask: 'generateOpenApiDocs', // springdoc-openapi-gradle-plugin
      generateCommand: null, // Maven 등 직접 지정 시 ["./mvnw","-q","verify"] 형태
      generatedFile: 'build/openapi.json',
      snapshot: 'docs/api/openapi.json', // 커밋되는 계약 스냅샷
      timeoutSec: 300,
    },
    frontend: {
      specFrom: null, // 프론트 레포에서 읽을 명세 경로 (기본: <peerPath>/docs/api/openapi.json)
      typesOut: 'src/api/generated/schema.ts',
      srcDir: 'src',
    },
  },
  stopLoopLimit: 3,
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** 프로젝트 루트: git 루트 → CLAUDE_PROJECT_DIR → cwd */
export function projectRoot(input = {}) {
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return gitRoot(cwd) || canon(process.env.CLAUDE_PROJECT_DIR || cwd);
}

/** 도구가 넘긴 파일 경로를 프로젝트 기준 실제 절대경로로 */
export function resolveFile(root, f) {
  return f ? canon(path.resolve(root, f)) : null;
}

export function loadConfig(root) {
  let cfg = DEFAULTS;
  cfg = deepMerge(cfg, readJson(path.join(root, '.claude', 'harness.json')));
  cfg = deepMerge(cfg, readJson(path.join(root, '.claude', 'harness.local.json')));
  return cfg;
}

/** 정규식 문자열 목록 중 하나라도 경로와 맞는지 (경로 구분자는 / 로 정규화) */
export function matchesAny(file, patterns = []) {
  const f = String(file || '').replace(/\\/g, '/');
  return patterns.some((p) => {
    try {
      return new RegExp(p, 'i').test(f);
    } catch {
      return false;
    }
  });
}

/** 도구 입력에서 대상 파일 경로 추출 */
export function toolFilePath(toolInput = {}) {
  return toolInput.file_path || toolInput.notebook_path || toolInput.path || null;
}

/** 시크릿 파일 여부 (readAllow 가 우선) */
export function isSecretPath(file, cfg) {
  if (!file) return false;
  if (matchesAny(file, cfg.secrets.readAllow)) return false;
  return matchesAny(file, cfg.secrets.readDeny);
}
