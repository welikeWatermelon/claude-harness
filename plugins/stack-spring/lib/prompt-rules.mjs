// prompt-rules.mjs — 사용자 프롬프트 판별 (모호한 구현 요청 감지)

export const IMPL = /(만들어|구현|추가해|추가하|개발해|짜\s?줘|작성해|고쳐|수정해|바꿔|리팩토링|리팩터링|적용해|붙여|연동해|넣어|삭제해|지워|없애|\bimplement\b|\bbuild\b|\bcreate\b|\badd\b|\bfix\b|\brefactor\b|\bremove\b)/i;
export const READONLY = /(설명|알려|왜|뭐야|무엇|어떻게\s*(돼|되)|분석|리뷰|검토|봐\s?줘|확인해|찾아|비교|요약|정리해\s*줘\??$|\?$)/;
export const SPECIFIC = /([\w-]+\.(java|kt|ts|tsx|js|jsx|py|sql|ya?ml|json|md|gradle|xml)\b|`[^`]+`|#L?\d+|\b[A-Z][a-zA-Z]+(Service|Controller|Repository|Entity|Dto|Config|Component|Hook|Page)\b|^\s*\d+[.)]\s|\n\s*[-*]\s)/m;

export function isVague(prompt) {
  const p = String(prompt || '').trim();
  if (!p || p.startsWith('/')) return false;
  if (!IMPL.test(p)) return false;
  if (READONLY.test(p) && p.length < 60) return false;
  if (SPECIFIC.test(p)) return false;
  return p.length < 100;
}
