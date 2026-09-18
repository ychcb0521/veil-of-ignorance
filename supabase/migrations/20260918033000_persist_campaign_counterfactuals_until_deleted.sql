-- A saved counterfactual is user-owned campaign history. Keep it until the user
-- explicitly deletes it (or the parent campaign itself is deleted by cascade).
DROP TRIGGER IF EXISTS tg_prune_campaign_counterfactuals ON public.campaign_counterfactuals;
DROP FUNCTION IF EXISTS public.prune_campaign_counterfactuals();
