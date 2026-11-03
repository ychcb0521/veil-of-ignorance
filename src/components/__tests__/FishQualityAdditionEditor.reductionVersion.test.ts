/** 【用户要求】2026-11-03 模板必须原样复原：支撑下移减仓的 v1 / v2 在打开、保存时原样保留，不因「保存」悄悄升级。 */
import { expect, it } from 'vitest';
import { additionDraft, parseAdditionDraft } from '@/components/FishQualityAdditionEditor';
import { additionIdentity, defaultQualityAddition, type QualityAdditionRule } from '@/lib/fish/qualityAddition';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';

const base = (): QualityAdditionRule => ({ ...defaultQualityAddition(), enabled: true });
const roundTrip = (rule: QualityAdditionRule) => parseAdditionDraft(additionDraft(rule), BUILTIN_FEATURES);
const tag = (rule: QualityAdditionRule) => JSON.stringify(additionIdentity(rule)).match(/support-drop-reduction-v\d/)?.[0];

it('11-02 存的方案（没写版本）打开再保存仍是 v1；新开启的默认 v2；勾选状态原样保留', () => {
  const v1 = { ...base(), supportReduction: { enabled: true, minDropAtr: .5, maxPct: 80 } };
  expect(tag(v1)).toBe('support-drop-reduction-v1');
  expect(roundTrip(v1).supportReduction).toEqual({ enabled: true, minDropAtr: .5, maxPct: 80 });
  const fresh = additionDraft(base());
  expect(fresh.supportReduction?.version).toBe(2);
  const enabled = parseAdditionDraft({ ...fresh, supportReduction: { ...fresh.supportReduction!, enabled: true } }, BUILTIN_FEATURES);
  expect(enabled.supportReduction).toMatchObject({ enabled: true, version: 2 });
  expect(tag(enabled)).toBe('support-drop-reduction-v2');
  expect(roundTrip(enabled).supportReduction?.version).toBe(2);
});
