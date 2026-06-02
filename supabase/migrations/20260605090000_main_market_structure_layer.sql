-- 市场结构层 — main-order only.《数字货币交易盈利策略》的「先判断结构，再决定打法」。
-- 同一个动作换个结构就改变性质：追涨在单边里对、在震荡里致命；止损在结构位是保护、在噪音里送钱。
-- 四个 additive、nullable 列，把快照变成「结构优先」的循环：
--   pre_market_regime    第 0 步 · 市场结构 regime：单边 trending / 震荡 ranging / 转换 transition。
--   pre_entry_stage      入场阶段：起步 early / 中段 middle / 末端 late。末端追价空间最薄、止损最尴尬。
--   pre_stop_quality     止损质量：结构失效位 structural / 拍脑袋百分比 arbitrary。
--   pre_chase_after_close 刚平就开的连续单标记（持单 = 耐心）。true=被标记，false=已检查无，NULL=不适用。
-- Append-only：每列都是 additive & nullable，不 drop 任何列。对冲单行为不动（主力单恒写、对冲恒 NULL）。
-- 旧记录读 NULL → 沿用既有「旧版快照」path。

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_market_regime text,
  ADD COLUMN IF NOT EXISTS pre_entry_stage text,
  ADD COLUMN IF NOT EXISTS pre_stop_quality text,
  ADD COLUMN IF NOT EXISTS pre_chase_after_close boolean;

-- CHECK constraints (added separately so re-runs stay idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_pre_market_regime_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_pre_market_regime_check
      CHECK (pre_market_regime IS NULL OR pre_market_regime IN (
        'trending',
        'ranging',
        'transition'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_pre_entry_stage_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_pre_entry_stage_check
      CHECK (pre_entry_stage IS NULL OR pre_entry_stage IN (
        'early',
        'middle',
        'late'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_journals_pre_stop_quality_check'
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_pre_stop_quality_check
      CHECK (pre_stop_quality IS NULL OR pre_stop_quality IN (
        'structural',
        'arbitrary'
      ));
  END IF;
END $$;

-- 结构 / 阶段分析：盈亏按 regime、入场阶段聚合（哪种结构里你赚钱 / 亏钱）。
CREATE INDEX IF NOT EXISTS idx_trade_journals_pre_market_regime
  ON public.trade_journals(user_id, pre_market_regime);
CREATE INDEX IF NOT EXISTS idx_trade_journals_pre_entry_stage
  ON public.trade_journals(user_id, pre_entry_stage);
