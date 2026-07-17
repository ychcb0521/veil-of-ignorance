-- Keep deleted campaigns recoverable until the owner explicitly removes them forever.
ALTER TABLE public.trade_campaigns
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_trade_campaigns_user_deleted_at
  ON public.trade_campaigns(user_id, deleted_at DESC);

COMMENT ON COLUMN public.trade_campaigns.deleted_at IS
  'Soft-delete timestamp. NULL means visible; non-NULL means recoverable in the campaign recycle bin.';

-- A mutual follower must not be able to open a campaign after its owner deletes it.
DROP POLICY IF EXISTS "Mutual followers select campaigns" ON public.trade_campaigns;
CREATE POLICY "Mutual followers select campaigns" ON public.trade_campaigns FOR SELECT USING (
  auth.uid() = user_id OR (
    deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM public.account_follows f1
      JOIN public.account_follows f2 ON f2.follower_id = user_id AND f2.followee_id = auth.uid()
      WHERE f1.follower_id = auth.uid() AND f1.followee_id = user_id
    )
  )
);

NOTIFY pgrst, 'reload schema';
