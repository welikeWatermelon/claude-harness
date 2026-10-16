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
        logEvent(root, cfg, sid, 'mode_change', { from: before, to: want });
        return addContext('UserPromptSubmit', `[하네스] 사용자가 모드를 '${before}' → '${want}' 로 바꿨어요. (${MODES[want]}) 이 내용을 한 줄로 확인해주세요.`);
      }
      return addContext('UserPromptSubmit', `[하네스] '${want}' 는 없는 모드예요. 가능한 모드: ${Object.keys(MODES).join(', ')}`);
    }

    // 새 턴 시작: 이전 턴의 승인 토큰·변경 목록 초기화
    // (Stop 에서 지우면 다른 플러그인의 Stop 훅이 block 해서 턴이 이어질 때 토큰이 사라지는 문제가 있어서 여기서 처리)
    updateSession(root, sid, (s) => {
      s.token = null;
      s.turnFiles = [];
      s.stopBlocks = 0;
      s.lastPrompt = redact(prompt).slice(0, 500);
      s.prompts = [...(s.prompts || []), s.lastPrompt].slice(-5);
      return s;
    });
    logEvent(root, cfg, sid, 'prompt', { text: prompt.slice(0, 2000) });

    const mode = getMode(root, cfg);
    if (mode === 'strict' && IMPL.test(prompt)) {
      return addContext('UserPromptSubmit', '[하네스 strict] 수정이 필요하면 EnterPlanMode → 분석 → 파일별 정확한 변경·명령·위험·롤백을 담은 계획으로 ExitPlanMode. 승인 전 수정은 차단돼요.');
    }
    if (cfg.vaguePromptNudge && isVague(prompt)) {
      return addContext(
        'UserPromptSubmit',
        '[하네스] 요청 범위가 모호해 보여요. 바로 구현하지 말고 Plan 모드로 ① 바뀔 파일 ② 완료 조건(통과해야 할 테스트 목록) ③ 확인이 필요한 질문을 먼저 제시하고 승인받으세요.',
      );
    }
    return pass();
  },
  { failClosed: false, name: 'core/user-prompt' },
);
