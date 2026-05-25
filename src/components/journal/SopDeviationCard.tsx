import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { Deduction, SopDeviationResult } from '@/lib/campaignAnalysis';

interface Props {
  result: SopDeviationResult;
  active: boolean;
  historicalWarning?: boolean;
  onJumpToEvent?: (eventIds: string[]) => void;
}

const HERO_TEXT: Record<Exclude<SopDeviationResult['grade'], null>, string> = {
  A: '完全按 SOP 执行 ✓',
  B: '基本按 SOP，细节可优化',
  C: '半按半不按，有显著可改进',
  D: '较多偏离 SOP',
  F: '几乎未按 SOP 执行',
};

const HERO_STYLE: Record<Exclude<SopDeviationResult['grade'], null>, string> = {
  A: 'text-[#0ECB81] bg-[#0ECB81]/15',
  B: 'text-foreground bg-[#0ECB81]/10',
  C: 'text-[#F0B90B] bg-[#F0B90B]/15',
  D: 'text-[#F6465D] bg-[#F6465D]/10',
  F: 'text-[#F6465D] bg-[#F6465D]/20 font-bold',
};

const GROUPS: Array<{ key: Deduction['category']; title: string; total: number }> = [
  { key: 'setup', title: 'Setup 阶段', total: 30 },
  { key: 'lockin', title: 'Lock-in 阶段', total: 25 },
  { key: 'rolling', title: 'Rolling 阶段', total: 25 },
  { key: 'exit', title: 'Exit 阶段', total: 20 },
];

export function SopDeviationCard({ result, active, historicalWarning = false, onJumpToEvent }: Props) {
  const grouped = useMemo(() => {
    return GROUPS.map(group => ({
      ...group,
      deductions: result.deductions.filter(item => item.category === group.key),
      deducted: result.deductions
        .filter(item => item.category === group.key)
        .reduce((sum, item) => sum + item.points, 0),
    }));
  }, [result.deductions]);

  if (!result.is_applicable) {
    return (
      <div className="bg-card border border-border rounded p-6 text-[12px] text-muted-foreground">
        自定义模板不参与 SOP 评分
      </div>
    );
  }

  if (result.score == null || result.grade == null) return null;

  return (
    <div className="bg-card border border-border rounded p-6 space-y-5">
      {active && (
        <div className="bg-muted/50 border border-border rounded px-3 py-2 text-[11px] text-muted-foreground">
          战役进行中，SOP 评分仅基于当前已发生的事件，可能随后续操作变化。结束战役后再做最终评估。
        </div>
      )}
      {historicalWarning && (
        <div className="bg-muted/50 border border-border rounded p-2 text-[11px] text-muted-foreground">
          本战役含历史归类项。由于缺少实时记录的取消/挂单事件，部分扣分项可能不准确。SOP 评分仅供参考。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[180px_160px_1fr] gap-4 items-center">
        <div className={`font-mono text-[64px] leading-none ${HERO_STYLE[result.grade].split(' ')[0]}`}>{result.score}</div>
        <div className={`inline-flex items-center justify-center h-10 px-4 rounded text-[16px] font-bold ${HERO_STYLE[result.grade]}`}>
          {result.grade}
        </div>
        <div className="text-[14px]">{HERO_TEXT[result.grade]}</div>
      </div>

      <Accordion type="multiple" defaultValue={GROUPS.map(group => group.key)} className="w-full">
        {grouped.map((group: typeof grouped[number]) => (
          <AccordionItem key={group.key} value={group.key}>
            <AccordionTrigger className="py-3 hover:no-underline">
              <div className="flex items-center gap-2 text-left">
                <span>{group.title}</span>
                <span className="text-[11px] font-mono text-muted-foreground">-{group.deducted} / {group.total}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-2">
              {group.deductions.length === 0 ? (
                <div className="text-[11px] text-[#0ECB81]">✓ 此阶段无扣分</div>
              ) : (
                <div className="space-y-2">
                  {group.deductions.map((deduction: Deduction, index: number) => (
                    <div key={`${group.key}-${index}`} className="flex items-start gap-3 text-[11px] font-mono border border-border/40 rounded p-2">
                      <div className="text-[#F6465D] shrink-0">-{deduction.points} 分</div>
                      <div className="flex-1">{deduction.reason}</div>
                      <button
                        type="button"
                        onClick={() => onJumpToEvent?.(deduction.related_event_ids)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <div className="bg-accent/50 border-l-2 border-[#F0B90B] pl-4 py-3 rounded-r text-[12px] leading-relaxed">
        SOP 偏离度 ≠ 战役胜负。即使本场战役盈利，若分数 &lt;75，说明你是靠运气而非靠 SOP。
        连续 10 场 ≥85 分，才能称为"你已经把 SOP 内化"。在这之前，每次复盘都应当回到这张表。
      </div>
    </div>
  );
}
