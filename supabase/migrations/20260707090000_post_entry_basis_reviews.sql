-- 平仓评价：补充建仓时盈亏/胜率权衡依据的事后复盘。
ALTER TABLE public.trade_journals
  ADD COLUMN IF NOT EXISTS post_entry_payoff_basis_review text,
  ADD COLUMN IF NOT EXISTS post_entry_win_rate_basis_review text;
