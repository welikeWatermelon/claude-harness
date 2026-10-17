#!/usr/bin/env node
// stack-frontend / PreToolUse(Edit|Write|MultiEdit)
//   앱 설정·서명 파일(local.properties, google-services.json, keystore, GoogleService-Info.plist, *.xcconfig) 수정은 사용자 확인
//   코드 규칙 V1~V3(Vue)·A1~A5(Android)·I1~I3(iOS)·W3~W8(웹 공통)·X3(비밀값) — 신규 위반만
import { runHook, deny, ask, pass } from '../lib/hook-io.mjs';
import { editContext, checkRules, blockMessage } from '../lib/rules-hook.mjs';
import { FRONTEND_RULES, APP_PROTECTED } from '../lib/rules-frontend.mjs';
import { logEvent } from '../lib/logger.mjs';
import { detectFrontend } from '../lib/build-detect.mjs';

await runHook(
  async (input) => {
    const ec = editContext(input);
    if (!ec) return pass();
    if (APP_PROTECTED.test(ec.rel)) {
      logEvent(ec.sessionRoot, ec.cfg, ec.sessionId, 'rule', { id: 'X1', severity: 'ask', file: ec.rel });
      ask(`[X1] ${ec.rel} 는 앱 서명·키·빌드 설정 파일이에요. 잘못 바뀌면 빌드·배포·푸시가 깨지고, 비밀값이 커밋될 수 있어요. 바꿔도 될까요?`);
    }
    // 모노레포에서 React·백엔드 파일에는 적용하지 않음
    if (/\.(kt|java|swift|vue|ts|js|tsx|jsx|mjs|xml)$/.test(ec.rel) && !detectFrontend(ec.abs, ec.root)) return pass();
    const r = checkRules(ec, FRONTEND_RULES, 'frontend');
    if (r && r.blocks.length) deny(blockMessage(ec, r.blocks));
    return pass();
  },
  { failClosed: false, name: 'stack-frontend/pre-edit' },
);
