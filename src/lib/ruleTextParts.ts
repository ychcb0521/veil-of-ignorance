import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type { LegRole } from '@/types/journal';

/**
 * 【用户要求】规则页：「【战役偏离】不需要呈现；违规操作和修正后的规则要分行，视觉上要有鉴别力」。
 *
 * 战役偏离生成的规则文字固定是（见 campaignDeviationRules 的 buildRuleText）：
 *   【战役偏离】违规操作：{阶段}：{原因}。修正后的规则：{修正}
 * 这里只拆显示，不改存储：阶段是违规里第一个全角冒号之前的一小段（太长就不拆，原样留在违规里），
 * 阶段或违规开头若是 main_open / hedge_initial_a 这类腿角色代号，换成中文名。
 * 手写的规则（没有「修正后的规则：」）整段当作规则本身。
 */
export type RuleTextParts = {
  /** 违规发生在哪个阶段，如「1:1 镜像止盈之后的阶段」「主力开仓」；拆不出来为 null。 */
  phase: string | null;
  /** 违规操作；没有为 null。 */
  violation: string | null;
  /** 修正后的规则；手写规则就是整段原文。 */
  fix: string;
};

const PHASE_MAX_LENGTH = 24;

const ROLE_KEYS = (Object.keys(LEG_ROLE_LABELS) as LegRole[]).sort((a, b) => b.length - a.length);

/** 开头的腿角色代号换成中文名（后面紧跟的文字前补一个空格，免得粘在一起）。 */
function humanizeLeadingRole(text: string): string {
  for (const key of ROLE_KEYS) {
    if (text.startsWith(key)) {
      const rest = text.slice(key.length);
      if (rest === '') return LEG_ROLE_LABELS[key];
      // 代号后面直接接着字母数字的，说明不是代号（例如 main_open2），不换
      if (/^[A-Za-z0-9_]/.test(rest)) return text;
      return `${LEG_ROLE_LABELS[key]}${/^[：:，,。\s]/.test(rest) ? '' : ' '}${rest}`;
    }
  }
  return text;
}

function trimPunctuation(text: string): string {
  return text.trim().replace(/^[：:，,。\s]+/, '').replace(/[。．.\s]+$/, '').trim();
}

export function parseRuleTextParts(ruleText: string): RuleTextParts {
  const text = ruleText.trim().replace(/^【战役偏离】\s*/, '');
  const fixIndex = text.indexOf('修正后的规则');
  if (fixIndex < 0) return { phase: null, violation: null, fix: text };

  const fix = trimPunctuation(text.slice(fixIndex + '修正后的规则'.length));
  let violation = trimPunctuation(text.slice(0, fixIndex).replace(/^违规操作\s*[：:]?/, ''));
  if (!violation) return { phase: null, violation: null, fix };

  let phase: string | null = null;
  const colon = violation.indexOf('：');
  if (colon > 0 && colon <= PHASE_MAX_LENGTH) {
    const head = trimPunctuation(violation.slice(0, colon));
    const rest = trimPunctuation(violation.slice(colon + 1));
    if (head && rest) {
      phase = humanizeLeadingRole(head);
      violation = rest;
    }
  }
  if (!phase) violation = humanizeLeadingRole(violation);
  return { phase, violation, fix };
}
