import { describe, expect, it } from 'vitest';

import {
  buildReflectionText,
  parseReflectionText,
  REFLECTION_SEPARATOR_CORE,
} from '../reflectionFacts';

describe('buildReflectionText', () => {
  it('joins facts and interpretation with the readable separator', () => {
    const out = buildReflectionText('价格跌破前低后快速收回', '我把假突破当成了趋势反转');
    expect(out).toContain(REFLECTION_SEPARATOR_CORE);
    expect(out.startsWith('价格跌破前低后快速收回')).toBe(true);
    expect(out.endsWith('我把假突破当成了趋势反转')).toBe(true);
  });

  it('degrades to plain interpretation when facts are empty (backward compatible)', () => {
    expect(buildReflectionText('', '只学到一句话')).toBe('只学到一句话');
    expect(buildReflectionText('   ', '只学到一句话')).toBe('只学到一句话');
    expect(buildReflectionText('', '只学到一句话')).not.toContain(REFLECTION_SEPARATOR_CORE);
  });

  it('trims both segments', () => {
    const out = buildReflectionText('  事实  ', '  解释  ');
    expect(out).toBe(`事实\n\n${REFLECTION_SEPARATOR_CORE}\n\n解释`);
  });
});

describe('parseReflectionText', () => {
  it('round-trips facts + interpretation', () => {
    const stored = buildReflectionText('盘面事实多行\n第二行', '我的解释');
    const parsed = parseReflectionText(stored);
    expect(parsed.facts).toBe('盘面事实多行\n第二行');
    expect(parsed.interpretation).toBe('我的解释');
  });

  it('treats a legacy single-field reflection as interpretation only', () => {
    const parsed = parseReflectionText('这是旧版只有一段的复盘文字');
    expect(parsed.facts).toBe('');
    expect(parsed.interpretation).toBe('这是旧版只有一段的复盘文字');
  });

  it('handles null / undefined / empty', () => {
    expect(parseReflectionText(null)).toEqual({ facts: '', interpretation: '' });
    expect(parseReflectionText(undefined)).toEqual({ facts: '', interpretation: '' });
    expect(parseReflectionText('')).toEqual({ facts: '', interpretation: '' });
  });

  it('normalizes CRLF before splitting', () => {
    const stored = `事实\r\n\r\n${REFLECTION_SEPARATOR_CORE}\r\n\r\n解释`;
    const parsed = parseReflectionText(stored);
    expect(parsed.facts).toBe('事实');
    expect(parsed.interpretation).toBe('解释');
  });
});
