import { formatCampaignDisplayCode } from '@/lib/campaignCode';
import { campaignKlineTitleName } from '@/lib/campaignLegsPngExport';
import { buildEmotionDiaryExportSummary } from '@/lib/emotionDiary';
import type { DecisionEmotionDiary } from '@/types/emotionDiary';
import type { TradeCampaign } from '@/types/journal';

function safeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function answerBlock(question: string, answer: string): string {
  return `${question}\n${answer.trim() || '—'}`;
}

export function buildCampaignEmotionDiaryTxt(
  campaign: TradeCampaign,
  diary: DecisionEmotionDiary,
  accountName?: string | null,
): string {
  const summary = buildEmotionDiaryExportSummary(diary);
  const campaignCode = formatCampaignDisplayCode(
    campaign.campaign_code,
    accountName,
    campaign.id,
  );
  const measurementBlocks = summary.pomsTotal && summary.pomsDimensions
    ? [
      answerBlock('心境状态量表（POMS）总心境扰乱', summary.pomsTotal),
      answerBlock('心境状态量表（POMS）七个分量表', summary.pomsDimensions),
      answerBlock('正性情感（PANAS-PA）', summary.panasPositive ?? '—'),
      answerBlock('负性情感（PANAS-NA）', summary.panasNegative ?? '—'),
    ]
    : [
      answerBlock('历史情绪效价（SAM 1–9）', summary.legacyValence ?? '—'),
      answerBlock('历史情绪唤醒度（SAM 1–9）', summary.legacyArousal ?? '—'),
    ];
  return [
    answerBlock('关联战役', campaignKlineTitleName(campaign)),
    answerBlock('战役编号', campaignCode),
    answerBlock('操作日', summary.date),
    answerBlock('最近让内心起波澜的事情', summary.eventText),
    ...measurementBlocks,
    answerBlock('焦虑分量表（HADS-A）', summary.anxiety),
    answerBlock('抑郁分量表（HADS-D）', summary.depression),
    '说明\nPOMS 与 PANAS 用于纵向情绪研究记录，不设统一临床诊断区间；HADS 为筛查工具，分数不等同于临床诊断。',
  ].join('\n\n');
}

export function exportCampaignEmotionDiaryTxt(
  campaign: TradeCampaign,
  diary: DecisionEmotionDiary,
  accountName?: string | null,
): string {
  const code = formatCampaignDisplayCode(campaign.campaign_code, accountName, campaign.id);
  const fileName = safeFileName(`${campaignKlineTitleName(campaign)} 编号 ${code} 操作日情绪日记.txt`);
  const blob = new Blob(
    [`\uFEFF${buildCampaignEmotionDiaryTxt(campaign, diary, accountName)}`],
    { type: 'text/plain;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
