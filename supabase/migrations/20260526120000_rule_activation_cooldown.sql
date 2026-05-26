-- Rule activation cooldown: prevent users from silently deactivating rules right after creating them.
-- When a rule first becomes both is_active=true AND added_to_checklist=true, we stamp activated_at.
-- A 7-day cooldown then blocks any weakening change (deactivate / remove from checklist / clear required).

ALTER TABLE public.trading_rules
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

-- Backfill: any rule already active+in-checklist gets activated_at = updated_at (best-effort timestamp).
UPDATE public.trading_rules
   SET activated_at = updated_at
 WHERE activated_at IS NULL
   AND is_active = true
   AND added_to_checklist = true;

CREATE OR REPLACE FUNCTION public.trg_rule_activation_stamp() RETURNS trigger AS $$
BEGIN
  -- Stamp activated_at the first time a rule reaches active+in-checklist state.
  IF NEW.is_active = true
     AND NEW.added_to_checklist = true
     AND NEW.activated_at IS NULL THEN
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rule_activation_stamp ON public.trading_rules;
CREATE TRIGGER trg_rule_activation_stamp
  BEFORE INSERT OR UPDATE ON public.trading_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_rule_activation_stamp();
