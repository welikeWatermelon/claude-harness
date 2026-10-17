#!/usr/bin/env node
// core / UserPromptSubmit
//   1) 프롬프트 기록 (v1 은 대부분 "(prompt unavailable)" 로 남던 문제 수정)
//   2) 모드 전환: 사용자가 "/core:mode night" 처럼 입력하면 훅이 직접 기록
//      → 모델이 스스로 모드를 바꿔 제한을 푸는 것을 막기 위해 모드 변경은 이 경로로만 가능
//   3) 모호한 구현 요청이면 "계획 먼저" 안내를 짧게 주입
//      (v1 은 매 턴 1.5k자 정책문을 주입했음 → 필요할 때만, 300자 이내)
import { runHook, addContext, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { getMode, setMode, updateSession, MODES } from '../lib/state.mjs';
import { logEvent, redact } from '../lib/logger.mjs';
import { IMPL, isVague } from '../lib/prompt-rules.mjs';
import { gateStatus } from '../lib/plan-gate.mjs';


await runHook(
  async (input) => {
    const prompt = String(input.prompt || '');
    const sid = input.session_id;
    const root = projectRoot(input);
    const cfg = loadConfig(root);

    // --- 모드 전환 (사용자 입력에서만) ---
    const m = prompt.match(/^\s*\/(?:core:)?mode\s+([a-z]+)/im) || prompt.match(/^\s*하네스\s*모드\s*[:：]?\s*([a-z]+)\s*$/im);
    if (m) {
      const want = m[1].toLowerCase();
      if (MODES[want]) {
        const before = getMode(root, cfg);
        setMode(root, want);
        // 모드가 바뀌면 이전 계획 승인은 끝남
        updateSession(root, sid, (s) => {
          s.token = null;
          return s;
        });
        logEvent(root, cfg, sid, 'mode_change', { from: before, to: want });
        return addContext('UserPromptSubmit', `[하네스] 사용자가 모드를 '${before}' → '${want}' 로 바꿨어요. (${MODES[want]}) 이 내용을 한 줄로 확인해주세요.`);
      }
      return addContext('UserPromptSubmit', `[하네스] '${want}' 는 없는 모드예요. 가능한 모드: ${Object.keys(MODES).join(', ')}`);
    }

    // --- 계획 승인 종료 (사용자만) ---
    if (/^\s*\/(?:core:)?plan-done\b/im.test(prompt)) {
      let had = null;
      updateSession(root, sid, (s) => {
        had = s.token;
        s.token = null;
        return s;
      });
      logEvent(root, cfg, sid, 'plan_done', { files: had?.files || [] });
      return addContext('UserPromptSubmit', had ? `[하네스] 사용자가 계획 승인을 끝냈어요. 이제 수정하려면 새 계획이 필요해요 (계획 게이트가 적용되는 경우). 끝난 범위: ${(had.files || []).join(', ') || '(이번 메시지 한정 승인)'}` : '[하네스] 끝낼 계획 승인이 없어요.');
    }

    // 새 턴 시작: 메시지 번호 증가, 이번 턴 변경 목록 초기화
    // 계획 승인 토큰은 여기서 지우지 않음 — 유효 여부는 plan-gate.tokenValid 가 판단
    //   (scope=files 는 계획 파일에 한해 다음 메시지에도 유효, scope=turn 은 승인한 메시지에서만)
    updateSession(root, sid, (s) => {
      s.promptCount = (s.promptCount || 0) + 1;
      s.turnFiles = [];
      s.stopBlocks = 0;
      s.lastPrompt = redact(prompt).slice(0, 500);
      s.prompts = [...(s.prompts || []), s.lastPrompt].slice(-5);
      return s;
    });
    logEvent(root, cfg, sid, 'prompt', { text: prompt.slice(0, 2000) });

    const mode = getMode(root, cfg);
    const gate = gateStatus(root, mode);
    if (gate.active && IMPL.test(prompt)) {
      return addContext(
        'UserPromptSubmit',
        `[하네스 계획 게이트: ${gate.reason === 'team-member' ? `팀원 ${gate.who}` : 'strict 모드'}] 승인된 계획 범위 밖 파일을 바꿔야 하면 EnterPlanMode → 분석 → "## 변경 파일" 목록과 변경 내용·명령·위험·롤백을 담아 ExitPlanMode.`,
      );
    }
    // 모호한 요청 안내: 기본은 게이트 대상(팀원/strict)에게만. 동등한 동료·본인에게는 강요하지 않음
    const nv = cfg.vaguePromptNudge;
    const nudge = nv === true ? 'always' : nv === false ? 'off' : nv || 'gated';
    if ((nudge === 'always' || (nudge === 'gated' && gate.active)) && isVague(prompt)) {
      return addContext(
        'UserPromptSubmit',
        '[하네스] 요청 범위가 모호해 보여요. 바로 구현하지 말고 Plan 모드로 ① 바뀔 파일 ② 완료 조건(통과해야 할 테스트 목록) ③ 확인이 필요한 질문을 먼저 제시하고 승인받으세요.',
      );
    }
    return pass();
  },
  { failClosed: false, name: 'core/user-prompt' },
);
