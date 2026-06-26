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

export const CLOSE_REVIEW_AUDIT_SEPARATOR_CORE = '———（平仓评价自审）———';
const LEGACY_CLOSE_REVIEW_AUDIT_SEPARATOR_CORES = ['———（平仓评价三问）———'];

export const CLOSE_REVIEW_AUDIT_QUESTIONS = [
  {
    key: 'decision_basis',
    title: '① 客观事实还是自洽借口',
    question: '这笔交易中，我是基于客观事实做出的决策，还是为了满足内在的“贪婪/恐惧”或“不愿认错”而强行找借口自洽？',
    placeholder: '写具体证据：哪些是可观察事实，哪些只是为了安抚贪婪、恐惧或不愿认错。',
  },
  {
    key: 'cycle_stage',
    title: '② 周期阶段是否辨认准确',
    question: '这笔交易中，我是否准确辨认了市场当前的“周期阶段”，还是在用错位的期待去逆势强求？',
    placeholder: '写当时所处阶段、支持它的事实，以及有没有把上一阶段/下一阶段的期待错套到现在。',
  },
  {
    key: 'trend_stop',
    title: '③ 顺势而止其所当止',
    question: '这在交易进行的过程中，我是否做到了“顺势而止其所当止”，没有因为乱动而额外制造麻烦？',
    placeholder: '写该止的地方是否止住了、该顺的地方是否顺住了，哪些额外动作是在制造麻烦。',
  },
  {
    key: 'schelling_floor_weight',
    title: '④ 谢林兜底区权重',
    question: '全程有无给谢林兜底区该有的权重？',
    placeholder: '写清楚：是否把谢林兜底区当成硬权重 / 高优先级锚点；如果没有，是被哪种噪音、期待或仓位压力挤掉了。',
  },
] as const;

export type CloseReviewAuditKey = typeof CLOSE_REVIEW_AUDIT_QUESTIONS[number]['key'];
export type CloseReviewAuditAnswers = Record<CloseReviewAuditKey, string>;

export interface CloseReviewReflectionParts {
  /** `post_reflection` 中不属于三问 block 的历史文本。保存时会原样保留。 */
  legacyText: string;
  answers: CloseReviewAuditAnswers;
}

export function emptyCloseReviewAuditAnswers(): CloseReviewAuditAnswers {
  return CLOSE_REVIEW_AUDIT_QUESTIONS.reduce((acc, question) => {
    acc[question.key] = '';
    return acc;
  }, {} as CloseReviewAuditAnswers);
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

function auditMarkerFor(key: CloseReviewAuditKey): string {
  const question = CLOSE_REVIEW_AUDIT_QUESTIONS.find(item => item.key === key);
  return `【${question?.title ?? key}】`;
}

function buildCloseReviewAuditBlock(answers: CloseReviewAuditAnswers): string {
  const body = CLOSE_REVIEW_AUDIT_QUESTIONS.map(question => {
    const answer = (answers[question.key] ?? '').trim();
    return `${auditMarkerFor(question.key)}\n${answer}`;
  }).join('\n\n');
  return `${CLOSE_REVIEW_AUDIT_SEPARATOR_CORE}\n\n${body}`;
}

export function parseCloseReviewReflectionText(raw: string | null | undefined): CloseReviewReflectionParts {
  const text = (raw ?? '').replace(/\r\n/g, '\n');
  const separator = [CLOSE_REVIEW_AUDIT_SEPARATOR_CORE, ...LEGACY_CLOSE_REVIEW_AUDIT_SEPARATOR_CORES]
    .map(core => ({ core, idx: text.indexOf(core) }))
    .filter(match => match.idx !== -1)
    .sort((a, b) => a.idx - b.idx)[0];
  const answers = emptyCloseReviewAuditAnswers();

  if (!separator) {
    return { legacyText: text.trim(), answers };
  }

  const legacyText = text.slice(0, separator.idx).trim();
  const auditBlock = text.slice(separator.idx + separator.core.length).trim();

  for (const question of CLOSE_REVIEW_AUDIT_QUESTIONS) {
    const marker = auditMarkerFor(question.key);
    const start = auditBlock.indexOf(marker);
    if (start === -1) continue;

    const answerStart = start + marker.length;
    const nextMarkerStarts = CLOSE_REVIEW_AUDIT_QUESTIONS
      .map(item => auditBlock.indexOf(auditMarkerFor(item.key), answerStart))
      .filter(nextStart => nextStart !== -1);
    const answerEnd = nextMarkerStarts.length > 0 ? Math.min(...nextMarkerStarts) : auditBlock.length;
    answers[question.key] = auditBlock.slice(answerStart, answerEnd).trim();
  }

  return { legacyText, answers };
}

export function buildCloseReviewReflectionText(
  raw: string | null | undefined,
  answers: CloseReviewAuditAnswers,
): string {
  const { legacyText } = parseCloseReviewReflectionText(raw);
  return [legacyText, buildCloseReviewAuditBlock(answers)].filter(Boolean).join('\n\n');
}

export function getCloseReviewAuditAnswer(
  raw: string | null | undefined,
  key: CloseReviewAuditKey,
): string {
  return parseCloseReviewReflectionText(raw).answers[key];
}
