
-- ===== 1. error_tag_categories =====
CREATE TABLE public.error_tag_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name_zh text NOT NULL,
  description text NOT NULL,
  color text NOT NULL,
  sort_order integer NOT NULL,
  is_special boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.error_tag_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view categories"
  ON public.error_tag_categories FOR SELECT
  TO authenticated USING (true);

-- ===== 2. error_tag_patterns =====
CREATE TABLE public.error_tag_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.error_tag_categories(id),
  pattern_name text NOT NULL,
  operational_definition text NOT NULL CHECK (length(operational_definition) >= 10),
  parent_id uuid REFERENCES public.error_tag_patterns(id),
  occurrence_count integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_patterns_user_category ON public.error_tag_patterns(user_id, category_id);
CREATE INDEX idx_patterns_user_archived ON public.error_tag_patterns(user_id, is_archived);
ALTER TABLE public.error_tag_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own patterns" ON public.error_tag_patterns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own patterns" ON public.error_tag_patterns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own patterns" ON public.error_tag_patterns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own patterns" ON public.error_tag_patterns FOR DELETE USING (auth.uid() = user_id);

-- ===== 3. trade_journals =====
CREATE TABLE public.trade_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_record_id text,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long','short','no_entry')),
  leverage integer,
  position_mode text,
  pre_simulated_time timestamptz NOT NULL,
  pre_real_time timestamptz NOT NULL DEFAULT now(),
  pre_entry_price numeric,
  pre_planned_stop_loss numeric,
  pre_planned_take_profit numeric,
  pre_entry_reason text NOT NULL,
  pre_mental_state integer NOT NULL CHECK (pre_mental_state BETWEEN 1 AND 5),
  pre_mental_trigger text,
  pre_risk_awareness text NOT NULL,
  pre_risk_management text NOT NULL,
  pre_checklist_items jsonb NOT NULL,
  pre_checklist_passed boolean NOT NULL,
  pre_position_size numeric,
  pre_max_loss_usdt numeric,
  post_outcome text CHECK (post_outcome IN ('win','loss','breakeven','no_entry')),
  post_realized_pnl numeric,
  post_r_multiple numeric,
  post_reflection text,
  post_correct_action text,
  post_reviewed_at timestamptz,
  reason_was_rewritten boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journals_user_time ON public.trade_journals(user_id, pre_simulated_time DESC);
CREATE INDEX idx_journals_user_outcome ON public.trade_journals(user_id, post_outcome);
CREATE INDEX idx_journals_user_symbol ON public.trade_journals(user_id, symbol);
ALTER TABLE public.trade_journals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own journals" ON public.trade_journals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own journals" ON public.trade_journals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own journals" ON public.trade_journals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own journals" ON public.trade_journals FOR DELETE USING (auth.uid() = user_id);

-- ===== 4. journal_tag_assignments =====
CREATE TABLE public.journal_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  journal_id uuid NOT NULL REFERENCES public.trade_journals(id) ON DELETE CASCADE,
  pattern_id uuid NOT NULL REFERENCES public.error_tag_patterns(id) ON DELETE CASCADE,
  tagged_phase text NOT NULL CHECK (tagged_phase IN ('pre','post')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journal_id, pattern_id, tagged_phase)
);
CREATE INDEX idx_assignments_user_pattern ON public.journal_tag_assignments(user_id, pattern_id, created_at DESC);
ALTER TABLE public.journal_tag_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own assignments" ON public.journal_tag_assignments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own assignments" ON public.journal_tag_assignments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own assignments" ON public.journal_tag_assignments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own assignments" ON public.journal_tag_assignments FOR DELETE USING (auth.uid() = user_id);

-- ===== 5. trading_rules =====
CREATE TABLE public.trading_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_pattern_id uuid REFERENCES public.error_tag_patterns(id) ON DELETE SET NULL,
  rule_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  added_to_checklist boolean NOT NULL DEFAULT false,
  trigger_threshold integer DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trading_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users select own rules" ON public.trading_rules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own rules" ON public.trading_rules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own rules" ON public.trading_rules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own rules" ON public.trading_rules FOR DELETE USING (auth.uid() = user_id);

-- ===== 6. Triggers =====

-- 6.1 update pattern stats on tag assignment
CREATE OR REPLACE FUNCTION public.fn_update_pattern_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.error_tag_patterns
       SET occurrence_count = occurrence_count + 1,
           last_seen_at = now(),
           updated_at = now()
     WHERE id = NEW.pattern_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.error_tag_patterns
       SET occurrence_count = GREATEST(occurrence_count - 1, 0),
           updated_at = now()
     WHERE id = OLD.pattern_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tg_update_pattern_stats
AFTER INSERT OR DELETE ON public.journal_tag_assignments
FOR EACH ROW EXECUTE FUNCTION public.fn_update_pattern_stats();

-- 6.2 updated_at on journals
CREATE TRIGGER tg_update_journal_updated_at
BEFORE UPDATE ON public.trade_journals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6.3 detect rewrite of pre_entry_reason
CREATE OR REPLACE FUNCTION public.fn_detect_reason_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.pre_entry_reason IS DISTINCT FROM OLD.pre_entry_reason THEN
    NEW.reason_was_rewritten := true;
  END IF;
  IF OLD.reason_was_rewritten = true AND NEW.reason_was_rewritten = false THEN
    NEW.reason_was_rewritten := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_detect_reason_rewrite
BEFORE UPDATE ON public.trade_journals
FOR EACH ROW EXECUTE FUNCTION public.fn_detect_reason_rewrite();

-- 6.4 updated_at on patterns + rules
CREATE TRIGGER tg_update_pattern_updated_at
BEFORE UPDATE ON public.error_tag_patterns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tg_update_rule_updated_at
BEFORE UPDATE ON public.trading_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== 7. Seed categories =====
INSERT INTO public.error_tag_categories (code, name_zh, description, color, sort_order, is_special) VALUES
  ('entry_reason',        '入场理由错',      '开仓时所依据的判断逻辑在事后被证伪，或在当时就违反了已确立的策略规则', '#F6465D', 1, false),
  ('hedge_stop',          '对冲/止损错',     '止损位、对冲腿、仓位规模的设置违反了预设风险预算或市场结构', '#F6465D', 2, false),
  ('exit_reason',         '出场理由错',      '平仓时机、平仓方式或止盈逻辑导致 R 倍数显著低于合理值', '#F6465D', 3, false),
  ('mental_state',        '心态/认知状态错', '决策时的心态自评 ≤2 分，或事后承认存在 FOMO、报复、过度自信、犹豫等情绪驱动', '#FCD535', 4, false),
  ('no_entry_missed',     '该开没开错',      '信号完整且符合预设规则，但因犹豫、注意力不足或外部干扰未开仓', '#848E9C', 5, true),
  ('checklist_violation', '流程错',          '在 checklist 未全部通过的情况下下单，或跳过了已确立的强制步骤', '#F0B90B', 6, false)
ON CONFLICT (code) DO NOTHING;
