/**
 * 复盘「事实 vs 解释」分离 — 把快照已有的双通道好设计（K线事实 vs 直觉解释）对称地搬到复盘。
 *
 * 第一性原理（芒格 · 叙事谬误 / WYSIATI）：人会把「发生了什么」和「为什么」压成一个自洽的故事，
 * 再把这个故事当成事实。复盘时先把盘面事实写下来，再写解释，能避免事后归因污染样本。
 *
 * 存储：仍写回既有的单列 `post_reflection`（不新增列、不需迁移）。两段用一个人类可读的分隔符拼接，
 * 因此即便在只做原文展示的地方（如 ContextChannelsStack）也能读，不会泄漏机器标记。
 * 旧记录没有分隔符 → 整段视为「解释」，向后兼容。
 */

/** 事实 / 解释 分隔符核心标记。用全角破折号与中文括号，几乎不可能出现在用户正文里。 */
export const REFLECTION_SEPARATOR_CORE = '———（先事实·后解释）———';

const SEPARATOR_BLOCK = `\n\n${REFLECTION_SEPARATOR_CORE}\n\n`;

export interface ReflectionParts {
  /** 盘面发生了什么（可观察事实）。旧记录为空。 */
  facts: string;
  /** 你的解释 / 学到了什么（必填项）。 */
  interpretation: string;
}

/**
 * 把「事实」「解释」两段拼成写库字符串。
 * 没有事实 → 退化为纯解释（与旧版单字段完全一致，保证向后兼容）。
 */
export function buildReflectionText(facts: string, interpretation: string): string {
  const f = facts.trim();
  const i = interpretation.trim();
  if (!f) return i;
  return `${f}${SEPARATOR_BLOCK}${i}`;
}

/**
 * 反解析写库字符串为两段。找不到分隔符 → 整段当作「解释」（旧记录向后兼容）。
 */
export function parseReflectionText(raw: string | null | undefined): ReflectionParts {
  const text = (raw ?? '').replace(/\r\n/g, '\n');
  const idx = text.indexOf(REFLECTION_SEPARATOR_CORE);
  if (idx === -1) {
    return { facts: '', interpretation: text.trim() };
  }
  return {
    facts: text.slice(0, idx).trim(),
    interpretation: text.slice(idx + REFLECTION_SEPARATOR_CORE.length).trim(),
  };
}
