
CREATE OR REPLACE FUNCTION public.fn_update_pattern_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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

CREATE OR REPLACE FUNCTION public.fn_detect_reason_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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
