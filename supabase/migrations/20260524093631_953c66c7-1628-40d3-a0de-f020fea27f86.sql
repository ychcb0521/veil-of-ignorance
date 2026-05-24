ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS order_kind text NOT NULL DEFAULT 'main'
    CHECK (order_kind IN ('main', 'hedge'));

ALTER TABLE public.trade_journals ALTER COLUMN pre_risk_awareness DROP NOT NULL;
ALTER TABLE public.trade_journals ALTER COLUMN pre_risk_management DROP NOT NULL;
ALTER TABLE public.trade_journals ALTER COLUMN pre_checklist_items DROP NOT NULL;
ALTER TABLE public.trade_journals ALTER COLUMN pre_checklist_passed DROP NOT NULL;

ALTER TABLE public.trade_journals
  ADD CONSTRAINT chk_main_order_completeness
  CHECK (
    order_kind = 'hedge'
    OR (
      pre_risk_awareness IS NOT NULL
      AND pre_risk_management IS NOT NULL
      AND pre_checklist_items IS NOT NULL
      AND pre_checklist_passed IS NOT NULL
    )
  );