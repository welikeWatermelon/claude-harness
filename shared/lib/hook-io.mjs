// hook-io.mjs — Claude Code 훅 입출력 공통 처리
// 이 파일은 shared/lib 이 원본이고, scripts/sync-lib.mjs 가 각 플러그인 lib/ 로 복사합니다.
// 플러그인 lib/ 안의 사본을 직접 고치지 마세요.

import { readFileSync } from 'node:fs';

/** stdin 의 훅 입력 JSON 을 읽습니다. 실패하면 빈 객체. */
export function readInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeJson(obj) {
  process.stdout.write(JSON.stringify(obj));
}

/** PreToolUse: 도구 호출 거부. Claude 에게 reason 이 전달됩니다. */
export function deny(reason) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
  process.exit(0);
}

/** PreToolUse: 사용자에게 확인 프롬프트를 띄웁니다. */
export function ask(reason) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  });
  process.exit(0);
}

/** 아무 결정 없이 통과 (기본 권한 흐름을 그대로 따름). */
export function pass() {
  process.exit(0);
}

/** SessionStart / UserPromptSubmit / PostToolUse 등에서 모델 컨텍스트 추가. */
export function addContext(eventName, text, extra = {}) {
  if (!text) process.exit(0);
  writeJson({
    ...extra,
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
  });
  process.exit(0);
}

/** Stop / PostToolUse 등: decision=block. Stop 에서는 Claude 가 멈추지 않고 reason 을 보고 계속 작업합니다. */
export function block(reason, extra = {}) {
  writeJson({ ...extra, decision: 'block', reason });
  process.exit(0);
}

/** 사용자 화면에만 보이는 메시지. */
export function systemMessage(text) {
  writeJson({ systemMessage: text });
  process.exit(0);
}

/**
 * 훅 본문을 감싸 실행합니다.
 * failClosed=true  → 내부 오류 시 도구 호출을 거부 (가드레일 훅)
 * failClosed=false → 내부 오류 시 조용히 통과 (로그·알림 훅)
 */
export async function runHook(fn, { failClosed = false, name = 'hook' } = {}) {
  try {
    await fn(readInput());
    process.exit(0);
  } catch (e) {
    const msg = `[harness:${name}] 내부 오류: ${e && e.message ? e.message : e}`;
    if (failClosed) {
      deny(`${msg}\n하네스 오류로 안전하게 차단했어요. /core:doctor 로 원인을 확인하세요.`);
    }
    process.stderr.write(msg + '\n');
    process.exit(0);
  }
}
