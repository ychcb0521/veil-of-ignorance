/**
 * Deep RSA 页面的展示层（纯展示，不取数）：研究进度、本机战役的暂定分组、特征定义、结论标注。
 * 【用户要求】左对齐紧凑、名字和数字挨着、对齐；从列表进详情再返回要回到原处（由页面外壳负责）。
 * 只读：不改原有功能和交易逻辑，不自动实盘，不编造结果——没有算过的东西一律写「待验证」。
 */
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBeijingTime } from '@/lib/timeFormat';
import { FEATURE_DEFINITIONS, type FeatureFamily } from '@/lib/deepRsa/features';
import { GROUP_ORDER, type CampaignGroupReport } from '@/lib/deepRsa/report';
import type { CampaignExcludedReason, CampaignPendingReason, ConditionState, DeepRsaGroup } from '@/lib/deepRsa/grouping';
import type { DeepRsaRunResult } from '@/lib/deepRsa/pipeline';
import { REP_LABEL, TARGET_LABEL } from '@/components/journal/DeepRsaRunPanel';

export const GROUP_LABEL: Record<DeepRsaGroup, string> = {
  positive: '正样本', control: '对照组', conflict: '冲突组', middle: '中间组', pending: '待判定', excluded: '排除',
};

const GROUP_TONE: Record<DeepRsaGroup, string> = {
  positive: 'text-[#0ECB81]',
  control: 'text-[#F6465D]',
  conflict: 'text-[#C98500] dark:text-[#F0B90B]',
  middle: 'text-foreground',
  pending: 'text-muted-foreground',
  excluded: 'text-muted-foreground/70',
};

const PENDING_LABEL: Record<CampaignPendingReason, string> = {
  unresolved_status: '未结束或未全部结算',
  no_anchor: '无锚点',
  payoff_basis_weak: '盈亏比来源弱',
  invalid_l0: 'L₀ 无效',
  corrections_incomplete: '校正未拉齐',
  corrections_unknown: '校正状态未知',
  condition_missing: '条件缺失',
  no_condition_known: '两条件都不可用',
};

const EXCLUDED_LABEL: Record<CampaignExcludedReason, string> = { deleted: '回收站', not_main_long: '非主多' };

const CONDITION_COLUMNS: { state: ConditionState; label: string }[] = [
  { state: 'gt3', label: '> 3' },
  { state: 'lt05', label: '< 0.5' },
  { state: 'mid', label: '中间' },
  { state: 'missing', label: '缺失' },
  { state: 'na', label: '无加仓' },
];

type StepStatus = 'done' | 'partial' | 'todo' | 'ran' | 'here';
const STEP_STATUS: Record<StepStatus, { label: string; tone: string }> = {
  done: { label: '已完成', tone: 'bg-[#0ECB81]/10 text-[#0B9F66] dark:text-[#0ECB81]' },
  partial: { label: '暂定分组已出', tone: 'bg-muted text-muted-foreground' },
  todo: { label: '待运行', tone: 'bg-muted text-muted-foreground' },
  ran: { label: '已运行', tone: 'bg-[#0ECB81]/10 text-[#0B9F66] dark:text-[#0ECB81]' },
  here: { label: '本页', tone: 'bg-[#F0B90B]/15 text-[#8F6B00] dark:text-[#F0B90B]' },
};

function stepsOf(run: DeepRsaRunResult | null | undefined): { n: number; name: string; status: StepStatus; doc: string }[] {
  const ran: StepStatus = run ? 'ran' : 'todo';
  return [
    { n: 1, name: '数据审计', status: 'done', doc: '01-data-audit.md' },
    { n: 2, name: '正样本 / 对照组', status: 'partial', doc: '02-grouping.md' },
    { n: 3, name: '48h 窗口与特征', status: ran, doc: '03-window-features.md' },
    { n: 4, name: 'RSA（训练集）', status: ran, doc: '04-rsa.md' },
    { n: 5, name: '样本外与回测', status: ran, doc: '05-oos-backtest.md' },
    { n: 6, name: '复盘中心入口', status: 'here', doc: '06-ui.md' },
  ];
}

type Verdict = '已验证' | '待验证' | '检验未获支持';
const VERDICT_TONE: Record<Verdict, string> = {
  已验证: 'text-[#0B9F66] dark:text-[#0ECB81]',
  待验证: 'text-muted-foreground',
  检验未获支持: 'text-[#F6465D]',
};

function conclusionsOf(run: DeepRsaRunResult | null | undefined): { claim: string; verdict: Verdict; basis: string }[] {
  const oosPassed = run?.oos.filter(r => r.verdict === '已验证') ?? [];
  return [
    { claim: '分组、窗口、权重、特征、RSA 检验、回测的计算实现正确', verdict: '已验证', basis: '单元测试' },
    { claim: '本页暂定分组的计数', verdict: '待验证', basis: '平仓价校正状态本页不可见' },
    run
      ? {
        claim: '有表征与「正 / 对照标签」或「24h 最大涨幅」同构',
        verdict: run.conclusions.rsa,
        basis: oosPassed.length
          ? `测试集 Holm p < 0.05：${oosPassed.map(r => `${REP_LABEL[r.representation]} × ${TARGET_LABEL[r.target]}`).join('、')}`
          : run.oos.length ? '训练集通过的项在测试集未通过' : '训练集无项通过 Holm 校正',
      }
      : { claim: '有表征与「正 / 对照标签」或「24h 最大涨幅」同构', verdict: '待验证', basis: '尚未运行' },
    { claim: '谢林候选能代表真实的谢林点', verdict: '待验证', basis: '三个候选并列计算，仅是代理' },
    run
      ? {
        claim: '模型在样本外扣成本后优于基线',
        verdict: run.conclusions.backtest,
        basis: run.backtest.skippedReason ?? '5 个基点：95% 区间下限 > 0 且高于两条基线',
      }
      : { claim: '模型在样本外扣成本后优于基线', verdict: '待验证', basis: '尚未运行' },
  ];
}

const FAMILY_LABEL: Record<FeatureFamily, string> = { price: '价格', orderFlow: '订单流（K 线代理）', schelling: '谢林（候选）' };

const MISSING = [
  '正式分组的平仓价校正拉齐状态（或导出 trade_campaigns / trade_journals 离线核对）',
  '信号库（本机 veil.signalLibrary.v1）用于信号来源的分组',
  '订单流只有 K 线级主动买入量代理；逐笔成交、历史盘口、持仓量没有',
];

function fmt(value: number | null, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-[12.5px] font-medium">{title}</h2>
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export interface DeepRsaViewProps {
  report: CampaignGroupReport | null;
  loading: boolean;
  loaded: number;
  total: number;
  group: DeepRsaGroup;
  onGroupChange: (group: DeepRsaGroup) => void;
  onOpenCampaign: (campaignId: string) => void;
  /** 第 3–5 步的运行入口（页面外壳给）。 */
  runPanel?: React.ReactNode;
  /** 最近一次运行结果：进度与结论按它更新。 */
  run?: DeepRsaRunResult | null;
}

export function DeepRsaView({ report, loading, loaded, total, group, onGroupChange, onOpenCampaign, runPanel, run }: DeepRsaViewProps) {
  const listed = report?.rows.filter(r => r.grouping.group === group) ?? [];
  return (
    <div className="space-y-7 text-[12px]">
      <Section title="进度" note="文档在仓库 docs/deep-rsa/">
        <ol className="grid grid-cols-[auto_auto_auto_1fr] items-center gap-x-3 gap-y-1.5">
          {stepsOf(run).map(step => (
            <li key={step.n} className="contents">
              <span className="font-mono tabular-nums text-muted-foreground">{step.n}</span>
              <span>{step.name}</span>
              <span className={cn('justify-self-start rounded px-1.5 py-px text-[10.5px]', STEP_STATUS[step.status].tone)}>{STEP_STATUS[step.status].label}</span>
              <span className="truncate font-mono text-[10.5px] text-muted-foreground/80">{step.doc}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="暂定分组" note="本机战役列表的现成读数 · 平仓价校正状态在本页不可见，按已拉齐处理">
        {!report ? (
          <div className="text-muted-foreground">
            {loading ? <>读取战役中… <span className="font-mono tabular-nums">{loaded}</span> / <span className="font-mono tabular-nums">{total}</span></> : '没有可用的战役'}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border/70 bg-muted/40 p-0.5" role="group" aria-label="分组">
              {GROUP_ORDER.map(g => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={g === group}
                  data-testid={`deep-rsa-group-${g}`}
                  onClick={() => onGroupChange(g)}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-[4px] px-2 transition-colors',
                    g === group ? 'bg-card font-medium shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-accent' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className={g === group ? GROUP_TONE[g] : undefined}>{GROUP_LABEL[g]}</span>
                  <span className="font-mono tabular-nums">{report.counts[g]}</span>
                </button>
              ))}
            </div>

            <table className="text-[11.5px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pr-4 text-left font-normal" />
                  {CONDITION_COLUMNS.map(c => <th key={c.state} className="pr-4 text-left font-normal">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {([['theoreticalB', '理论 b'], ['payoff', '盈亏比']] as const).map(([key, label]) => (
                  <tr key={key}>
                    <td className="pr-4 font-sans">{label}</td>
                    {CONDITION_COLUMNS.map(c => <td key={c.state} className="pr-4">{report.breakdown[key][c.state]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
              <span>
                去重后 <span className="font-mono tabular-nums text-foreground">{report.clusters}</span> 簇
                {report.conflictingClusters > 0 && <>，其中簇内一正一负 <span className="font-mono tabular-nums text-foreground">{report.conflictingClusters}</span></>}
              </span>
              {Object.entries(report.pendingReasons).map(([reason, n]) => (
                <span key={reason}>{PENDING_LABEL[reason as CampaignPendingReason]} <span className="font-mono tabular-nums text-foreground">{n}</span></span>
              ))}
            </div>

            {listed.length === 0 ? (
              <div className="text-muted-foreground">这一组没有战役</div>
            ) : (
              <table data-testid="deep-rsa-campaigns" className="text-[11.5px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="whitespace-nowrap py-1 pr-4 text-left font-normal">锚点<span className="max-sm:hidden">（北京时间）</span></th>
                    <th className="py-1 pr-4 text-left font-normal">标的</th>
                    <th className="py-1 pr-4 text-left font-normal">理论 b</th>
                    <th className="py-1 pr-4 text-left font-normal">盈亏比</th>
                    <th className="whitespace-nowrap py-1 text-left font-normal">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map(r => (
                    <tr
                      key={r.campaignId}
                      data-testid="deep-rsa-campaign-row"
                      onClick={() => onOpenCampaign(r.campaignId)}
                      title={`打开交易战役：${r.title}`}
                      className="group cursor-pointer border-b border-border/50 hover:bg-muted/50"
                    >
                      <td className="whitespace-nowrap py-1 pr-4 font-mono tabular-nums text-muted-foreground">
                        {r.anchorMs != null ? (
                          <>
                            <span className="max-sm:hidden">{formatBeijingTime(r.anchorMs).slice(0, 16)}</span>
                            <span className="sm:hidden">{formatBeijingTime(r.anchorMs).slice(5, 16)}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td className="py-1 pr-4">
                        <span className="inline-flex items-center gap-0.5">
                          {r.symbol}
                          <ArrowUpRight aria-hidden="true" className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </span>
                      </td>
                      <td className={cn('py-1 pr-4 font-mono tabular-nums', r.grouping.theoreticalB === 'gt3' && 'text-[#0ECB81]', r.grouping.theoreticalB === 'lt05' && 'text-[#F6465D]')}>
                        {r.grouping.theoreticalB === 'na' ? <span className="whitespace-nowrap font-sans text-muted-foreground">无加仓</span> : fmt(r.theoreticalB)}
                      </td>
                      <td className={cn('py-1 pr-4 font-mono tabular-nums', r.grouping.payoff === 'gt3' && 'text-[#0ECB81]', r.grouping.payoff === 'lt05' && 'text-[#F6465D]')}>
                        {fmt(r.payoffRatio)}
                      </td>
                      <td className="py-1 text-muted-foreground">
                        {[...r.grouping.pendingReasons.map(x => PENDING_LABEL[x]), ...r.grouping.excludedReasons.map(x => EXCLUDED_LABEL[x])].join('、')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Section>

      {runPanel && (
        <Section title="运行分析（第 3–5 步）" note="在你的浏览器里取币安公开行情 · 只读，不写数据、不下单">
          {runPanel}
        </Section>
      )}

      <Section title="特征" note={`48h 窗口 · 5m · 衰减权重 w = 2^(−Δt/h)，h ∈ {2, 6, 12} 小时 · ${FEATURE_DEFINITIONS.length} 个`}>
        <table className="text-[11.5px]">
          <tbody>
            {(['price', 'orderFlow', 'schelling'] as const).map(family => (
              <FeatureFamilyRows key={family} family={family} />
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="结论">
        <table className="text-[11.5px]">
          <tbody>
            {conclusionsOf(run).map(c => (
              <tr key={c.claim}>
                <td className={cn('whitespace-nowrap py-0.5 pr-4 align-top', VERDICT_TONE[c.verdict])}>{c.verdict}</td>
                <td className="py-0.5 pr-4 align-top">{c.claim}</td>
                <td className="py-0.5 align-top text-muted-foreground">{c.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="还缺什么">
        <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] text-muted-foreground">
          {MISSING.map(m => <li key={m}>{m}</li>)}
        </ul>
      </Section>
    </div>
  );
}

function tags(d: (typeof FEATURE_DEFINITIONS)[number]): string {
  return [d.candidate && '待确认', d.needsTaker && '需主动买入量'].filter(Boolean).join(' · ');
}

function FeatureFamilyRows({ family }: { family: FeatureFamily }) {
  const defs = FEATURE_DEFINITIONS.filter(d => d.family === family);
  return (
    <>
      <tr>
        <td colSpan={4} className="pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground first:pt-0">{FAMILY_LABEL[family]}</td>
      </tr>
      {defs.map(d => (
        <tr key={d.key} className="border-t border-border/40 align-top">
          <td className="py-1 pr-3 font-mono tabular-nums text-muted-foreground">{FEATURE_DEFINITIONS.indexOf(d) + 1}</td>
          <td className="py-1 pr-3 sm:whitespace-nowrap">
            {d.label}
            {/* 手机上公式与标记折到名称下面，不挤成一条窄列 */}
            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground sm:hidden">{d.formula}</div>
            {tags(d) && <div className="text-[10.5px] text-muted-foreground sm:hidden">{tags(d)}</div>}
          </td>
          <td className="py-1 pr-3 font-mono text-[10.5px] text-muted-foreground max-sm:hidden">{d.formula}</td>
          <td className="whitespace-nowrap py-1 text-[10.5px] text-muted-foreground max-sm:hidden">{tags(d)}</td>
        </tr>
      ))}
    </>
  );
}
