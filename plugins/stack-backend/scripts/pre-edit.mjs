#!/usr/bin/env node
// stack-backend / PreToolUse(Edit|Write|MultiEdit)
//   B2  이미 커밋된 마이그레이션 수정 차단 (Prisma·Alembic·Django·Knex/TypeORM·golang-migrate·Rails)
//       → 적용된 환경과 이력이 어긋나 배포가 깨짐. 아직 커밋 안 된(작성 중) 파일은 허용
//   B1·B3~B9·B11  코드 규칙 (lib/rules-backend.mjs, 신규 위반만)
import { runHook, deny, pass } from '../lib/hook-io.mjs';
import { editContext, checkRules, blockMessage } from '../lib/rules-hook.mjs';
import { BACKEND_RULES, MIGRATION_PATH } from '../lib/rules-backend.mjs';
import { severityOf } from '../lib/code-rules.mjs';
import { git } from '../lib/proc.mjs';
import { logEvent } from '../lib/logger.mjs';

await runHook(
  async (input) => {
    const ec = editContext(input);
    if (!ec) return pass();
    if (MIGRATION_PATH.test(ec.rel) && ec.oldText !== null && severityOf({ id: 'B2', severity: 'block' }, ec.cfg) !== 'off') {
      const tracked = git(['ls-files', '--error-unmatch', ec.rel], ec.root).ok;
      if (tracked) {
        logEvent(ec.sessionRoot, ec.cfg, ec.sessionId, 'rule', { id: 'B2', severity: 'block', file: ec.rel });
        deny(
          `[B2] ${ec.rel} 는 이미 커밋된 마이그레이션이에요. 고치면 이미 적용된 DB 와 이력이 어긋나요(체크섬·순서 오류).\n` +
            '변경 내용은 새 마이그레이션으로 만드세요 (prisma migrate dev / alembic revision / makemigrations / knex migrate:make / migrate create).\n' +
            '아직 어디에도 적용되지 않은 게 확실하면 사용자에게 확인받고 .claude/harness.local.json 에 "rules": { "B2": "off" } 를 잠시 두세요.',
        );
      }
    }
    const r = checkRules(ec, BACKEND_RULES, 'backend');
    if (r && r.blocks.length) deny(blockMessage(ec, r.blocks));
    return pass();
  },
  { failClosed: false, name: 'stack-backend/pre-edit' },
);
