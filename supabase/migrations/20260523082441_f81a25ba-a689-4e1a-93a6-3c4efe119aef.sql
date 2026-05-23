
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_error_scenario text,
  ADD COLUMN IF NOT EXISTS post_original_hypothesis text,
  ADD COLUMN IF NOT EXISTS post_reality_feedback text,
  ADD COLUMN IF NOT EXISTS post_error_type_summary text,
  ADD COLUMN IF NOT EXISTS post_real_problem text,
  ADD COLUMN IF NOT EXISTS post_new_rule_draft text,
  ADD COLUMN IF NOT EXISTS deep_analysis_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.fn_update_deep_analysis_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.post_error_scenario IS NOT NULL AND length(trim(NEW.post_error_scenario)) > 0
     AND NEW.post_original_hypothesis IS NOT NULL AND length(trim(NEW.post_original_hypothesis)) > 0
     AND NEW.post_reality_feedback IS NOT NULL AND length(trim(NEW.post_reality_feedback)) > 0
     AND NEW.post_error_type_summary IS NOT NULL AND length(trim(NEW.post_error_type_summary)) > 0
     AND NEW.post_real_problem IS NOT NULL AND length(trim(NEW.post_real_problem)) > 0
     AND NEW.post_new_rule_draft IS NOT NULL AND length(trim(NEW.post_new_rule_draft)) > 0
  THEN
    IF NEW.deep_analysis_completed_at IS NULL THEN
      NEW.deep_analysis_completed_at := now();
    END IF;
  ELSE
    NEW.deep_analysis_completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deep_analysis_completed_at ON public.trade_journals;
CREATE TRIGGER trg_deep_analysis_completed_at
  BEFORE INSERT OR UPDATE ON public.trade_journals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_deep_analysis_completed_at();
