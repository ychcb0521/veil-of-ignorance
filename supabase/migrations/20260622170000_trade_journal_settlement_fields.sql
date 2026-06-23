-- Capture settlement context for opening snapshots.
-- Existing journals stay valid; null settlement mode means legacy USDT-margined.

ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS pre_settlement_mode text,
  ADD COLUMN IF NOT EXISTS pre_settlement_asset text,
  ADD COLUMN IF NOT EXISTS pre_contract_size_usd numeric,
  ADD COLUMN IF NOT EXISTS pre_contracts numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trade_journals_pre_settlement_mode_check'
      AND conrelid = 'public.trade_journals'::regclass
  ) THEN
    ALTER TABLE public.trade_journals
      ADD CONSTRAINT trade_journals_pre_settlement_mode_check
      CHECK (pre_settlement_mode IS NULL OR pre_settlement_mode IN ('usdt', 'coin'));
  END IF;
END $$;
