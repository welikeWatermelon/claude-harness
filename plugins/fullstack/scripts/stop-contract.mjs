#!/usr/bin/env node
// fullstack / Stop (backend) — API 계약 검사
//   1) 이번 세션에 Controller·DTO 등을 바꿨으면 springdoc 으로 OpenAPI 명세 생성 (Gradle 플러그인)
//   2) 커밋된 스냅샷(docs/api/openapi.json)과 비교 → 스냅샷 갱신 + docs/api/API_CHANGES.md 기록
//   3) 깨지는 변경이면 프론트 레포에서 사용처를 찾아 한 번 block:
//      - 기본: 프론트를 고친다 (타입·API 함수·매핑)
//      - 화면에 보이는 값이 사라지거나 의미가 바뀌면: 프론트를 임의로 바꾸지 말고 결정 대기 목록에 넣는다
//        (백엔드를 고쳐야 할 수 있으므로 개발자에게 마지막에 질문)
//   night/readonly 모드에서는 앱을 띄울 수 없으니 건너뛰고 다음에 검사
import path from 'node:path';
import { runHook, block, systemMessage, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { loadSession, updateSession, getMode } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';
import { fsCfg, peerRoot, generateSpec, compareAndSave, findUsages, appendChangeLog } from './contract.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const fs = fsCfg(cfg);
    if (fs.role !== 'backend') return pass();
    const sid = input.session_id;
    const s = loadSession(root, sid);
    if (!s.dirty || !s.dirty.api) return pass();
    const mode = getMode(root, cfg);
    if (mode === 'night' || mode === 'readonly') return pass(); // 표시를 남겨두고 다음 검사로

    updateSession(root, sid, (x) => {
      x.dirty.api = false;
      return x;
    });
    const gen = generateSpec(root, fs);
    if (!gen.ok) {
      logEvent(root, cfg, sid, 'contract', { ok: false, error: gen.error.slice(0, 300) });
      return systemMessage(`⚠ API 명세를 만들지 못해 계약 검사를 건너뛰었어요. /fullstack:setup 으로 설정을 확인하세요.\n${gen.error.slice(0, 800)}`);
    }
    const { first, changes, snapshot } = compareAndSave(root, fs, gen);
    const rel = path.relative(root, snapshot).replace(/\\/g, '/');
    if (first) return systemMessage(`✓ API 계약 스냅샷을 처음 만들었어요: ${rel} (커밋해서 프론트 레포와 공유하세요)`);
    if (!changes.length) return systemMessage('✓ API 계약 변경 없음');

    const breaking = changes.filter((c) => c.severity === 'breaking');
    const logFile = appendChangeLog(root, fs, changes);
    logEvent(root, cfg, sid, 'contract', { ok: true, breaking: breaking.length, compatible: changes.length - breaking.length });
    if (!breaking.length) {
      return systemMessage(`✓ API 계약: 호환되는 변경 ${changes.length}건 (${changes.map((c) => c.target).slice(0, 5).join(', ')}) → 프론트 레포에서 /fullstack:api-sync 로 타입을 갱신하세요.`);
    }

    const peer = peerRoot(root, fs);
    const usage = findUsages(peer, fs, breaking);
    const lines = usage.map(({ change, usages }) => {
      const u = usages.length
        ? usages.map((h) => `      ${h.display ? '[화면]' : '[코드]'} ${h.file}:${h.line}  ${h.text}`).join('\n')
        : '      (프론트에서 사용처를 찾지 못함)';
      return `  ■ ${change.target} — ${change.detail}\n${u}`;
    });
    return block(
      `[fullstack] 프론트를 깨뜨릴 수 있는 API 변경 ${breaking.length}건을 찾았어요. (기록: ${path.relative(root, logFile).replace(/\\/g, '/')})\n` +
        `${peer ? `프론트 레포: ${peer}` : '프론트 레포 경로(fullstack.peerPath)가 없어서 사용처를 찾지 못했어요.'}\n\n${lines.join('\n')}\n\n` +
        '처리 원칙:\n' +
        '  1) 기본은 프론트를 고친다 — [코드] 사용처(API 함수·타입·매핑)를 새 계약에 맞게 수정 (프론트 레포의 브랜치 규칙도 적용돼요)\n' +
        '  2) [화면] 사용처에서 보여주던 값이 사라지거나 의미가 바뀌면 프론트를 임의로 바꾸지 말 것 → 백엔드를 되돌려야 할 수도 있으니\n' +
        '     .harness/pending-decisions.md 에 결정 항목(D번호)으로 적고 관련 작업만 보류, 나머지는 계속\n' +
        '  3) 처리 결과를 API_CHANGES.md 해당 항목 아래에 한 줄씩 적기',
    );
  },
  { failClosed: false, name: 'fullstack/stop-contract' },
);
