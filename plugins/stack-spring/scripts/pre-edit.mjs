#!/usr/bin/env node
// stack-spring / PreToolUse(Edit|Write|MultiEdit)
//   - 이미 존재하는 Flyway 버전 마이그레이션(V*__*.sql) 수정 차단 → checksum 오류로 기동 실패 방지
//     (MelonMe /new-migration 규칙 "기존 마이그레이션 파일 수정 금지" 를 훅으로 승격)
//   - Spring 코드 규칙 S1~S17 (lib/rules-spring.mjs)
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runHook, deny, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig, toolFilePath, resolveFile } from '../lib/config.mjs';
import { logEvent } from '../lib/logger.mjs';
import { editContext, checkRules, blockMessage } from '../lib/rules-hook.mjs';
import { SPRING_RULES } from '../lib/rules-spring.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const f = toolFilePath(input.tool_input || {});
    if (!f) return pass();
    const abs = resolveFile(root, f);
    const norm = abs.replace(/\\/g, '/');
    if (cfg.spring.blockEditingAppliedMigrations && /\/db\/migration\/.*\/?V\d+(_\d+)*__[^/]+\.sql$/i.test(norm) && existsSync(abs)) {
      logEvent(root, cfg, input.session_id, 'guard', { tool: input.tool_name, decision: 'deny', rule: 'flyway-edit-applied', reason: f });
      deny(
        `이미 있는 Flyway 마이그레이션(${path.basename(abs)})은 수정하지 않아요 — 적용된 환경에서 checksum 불일치로 기동이 실패해요.\n` +
          '변경이 필요하면 다음 버전 번호로 새 마이그레이션 파일을 만드세요 (/stack-spring:new-migration).\n' +
          '아직 어디에도 적용되지 않은 로컬 전용 파일이 확실하면 사용자에게 확인받고 .claude/harness.local.json 에 spring.blockEditingAppliedMigrations=false 를 잠시 두세요.',
      );
    }
    // 코드 규칙 S1~S17 (신규 위반만). block → 거부, warn → PostToolUse 에서 전달
    const ec = editContext(input);
    const r = checkRules(ec, SPRING_RULES, 'spring');
    if (r && r.blocks.length) deny(blockMessage(ec, r.blocks));
    return pass();
  },
  { failClosed: false, name: 'stack-spring/pre-edit' },
);
