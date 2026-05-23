/**
 * 高频模式强制规则弹窗 — 不可关闭。
 */
import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { AlertOctagon } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { createRule, markRuleAddedToChecklist, snoozeRulePattern, updateRule } from '@/lib/journalApi';
import type { CriticalPatternInfo } from '@/lib/criticalPatternDetector';

interface Props {
  info: CriticalPatternInfo | null;
  userId: string;
  onResolved: () => void;
}

export function MandatoryRuleDialog({ info, userId, onResolved }: Props) {
  const [text, setText] = useState('');
  const [required, setRequired] = useState<'true' | 'false'>('true');
  const [saving, setSaving] = useState(false);
  const [snoozing, setSnoozing] = useState(false);

  if (!info) return null;
  const canSubmit = text.trim().length >= 20 && !saving;

  const handleSave = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const rule = await createRule({
        user_id: userId,
        source_pattern_id: info.pattern.id,
        rule_text: text.trim(),
        is_active: true,
      });
      // Mark added to checklist + required
      await fetch; // no-op for linter; actual update via updateRule
      await import('@/lib/journalApi').then(api =>
        api.updateRule(rule.id, { added_to_checklist: true, required: required === 'true' }),
      );
      await markRuleAddedToChecklist(rule.id).catch(() => {});
      toast.success('规则已写入 checklist');
      setText(''); setRequired('true');
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSnooze = async () => {
    setSnoozing(true);
    try {
      await snoozeRulePattern(userId, info.pattern.id, 24);
      toast.message('已延后 24 小时');
      setText(''); setRequired('true');
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSnoozing(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => { /* blocked */ }}>
      <DialogContent
        className="max-w-[560px] bg-[#181A20] border border-[#F6465D] p-0"
        onPointerDownOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
      >
        <div className="bg-[#F6465D]/10 px-5 py-3 border-b border-[#F6465D]/30 flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-[#F6465D]" />
          <span className="text-[14px] font-medium">新规则强制生成</span>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-[12px] text-foreground">
            模式「<span className="text-[#F6465D] font-medium">{info.pattern.pattern_name}</span>」在最近 30 天内已出现 {info.last_30d_count} 次，平均 P&amp;L = {info.avg_pnl.toFixed(2)} USDT。
            根据预设反馈规则：同一模式 30 天 ≥3 次 → 必须转化为新规则加入 checklist。
          </p>

          <div className="border-l-2 border-[#F0B90B] pl-3 text-[12px] text-foreground/90 italic">
            {info.pattern.operational_definition}
          </div>

          {info.recent_journals.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">最近触发此模式的交易：</div>
              <div className="flex flex-wrap gap-1.5">
                {info.recent_journals.map(j => (
                  <Link key={j.id} to={`/journal/${j.id}`}
                    className="bg-[#2B3139] hover:bg-[#363c45] rounded px-2 py-1 text-[11px] font-mono text-foreground">
                    {j.symbol} · {new Date(j.pre_simulated_time).toLocaleDateString('zh-CN')}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[12px]">新规则文字 *</Label>
            <Textarea
              rows={3}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="例如：开仓前必须确认 ATR(14) ≥ 50，否则止损位过近，禁止入场"
              className="text-[12px] bg-[#0B0E11] border-[#2B3139]"
            />
            <p className="text-[10px] text-muted-foreground">
              ❗ 必须可被未来的你在 checklist 上勾选/不勾选——避免空泛。{text.trim().length}/20
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px]">是否设为必填 *</Label>
            <RadioGroup value={required} onValueChange={(v) => setRequired(v as 'true' | 'false')} className="flex gap-4">
              <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                <RadioGroupItem value="true" /> 必填 ✓
              </label>
              <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                <RadioGroupItem value="false" /> 可选
              </label>
            </RadioGroup>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#2B3139] flex justify-between">
          <Button
            variant="ghost"
            disabled={snoozing}
            onClick={handleSnooze}
            className="h-8 text-[12px] text-muted-foreground hover:text-foreground"
          >
            {snoozing ? '延后中...' : '延后 24 小时'}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSubmit}
            className="h-8 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black disabled:opacity-40"
          >
            {saving ? '写入中...' : '写入 checklist'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
