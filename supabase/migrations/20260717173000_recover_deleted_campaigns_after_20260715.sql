-- Recover campaigns that were permanently deleted before the recycle-bin
-- release. The exported campaign images are the durable audit record for the
-- campaign ids; surviving journal rows are reattached when available.
DO $$
DECLARE
  recovered_user_id uuid;
  profit_campaign_id constant uuid := '5027aa13-59cd-4082-8bdd-b5576815e853';
  loss_campaign_id constant uuid := 'ac5fc21e-a628-40b2-899a-093072e7d734';
BEGIN
  SELECT j.user_id
  INTO recovered_user_id
  FROM public.trade_journals j
  WHERE upper(replace(j.symbol, '/', '')) = 'FISUSDT'
    AND j.pre_simulated_time >= '2025-09-13 13:00:00+00'::timestamptz
    AND j.pre_simulated_time < '2025-09-13 14:45:00+00'::timestamptz
    AND j.pre_entry_price BETWEEN 0.119 AND 0.130
  ORDER BY
    CASE WHEN j.leg_sequence = 3 THEN 0 ELSE 1 END,
    j.created_at DESC
  LIMIT 1;

  -- If the journal evidence is absent, do not invent an owner or expose the
  -- recovered campaigns to another account.
  IF recovered_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.trade_campaigns (
    id,
    user_id,
    campaign_code,
    symbol,
    direction,
    status,
    strategy_template,
    title,
    opened_at,
    closed_at,
    initial_main_size_usdt,
    initial_leverage,
    final_realized_pnl,
    final_r_multiple,
    peak_unrealized_pnl,
    peak_drawdown,
    notes,
    actual_evolution,
    importance_weight,
    deviation_notes,
    created_at,
    updated_at,
    deleted_at
  ) VALUES
  (
    profit_campaign_id,
    recovered_user_id,
    'C-5027AA1359CD40828BDDB5576815E853',
    'FISUSDT',
    'main_long',
    'closed_profit',
    'main_dual_hedge_mirror_tp',
    'FISUSDT 2025-09-13 多战役',
    '2025-09-13 13:03:00+00'::timestamptz,
    '2025-09-13 14:41:00+00'::timestamptz,
    99952.88,
    5,
    NULL,
    NULL,
    NULL,
    NULL,
    '由 2026-07-15 历史导出记录恢复到回收区。',
    '[]'::jsonb,
    0,
    '{}'::jsonb,
    '2026-07-14 21:14:00+08'::timestamptz,
    '2026-07-15 16:59:53+08'::timestamptz,
    '2026-07-15 16:59:53+08'::timestamptz
  ),
  (
    loss_campaign_id,
    recovered_user_id,
    'C-AC5FC21EA62840B2899A093072E7D734',
    'FISUSDT',
    'main_long',
    'closed_loss',
    'main_dual_hedge_mirror_tp',
    'FISUSDT 2025-09-13 多战役',
    '2025-09-13 13:03:00+00'::timestamptz,
    '2025-09-13 14:41:00+00'::timestamptz,
    99952.88,
    5,
    -6611.77,
    NULL,
    6717.49,
    8819.37,
    '由 2026-07-15 历史导出记录恢复到回收区。',
    '[]'::jsonb,
    0,
    '{}'::jsonb,
    '2026-07-14 21:14:00+08'::timestamptz,
    '2026-07-15 21:15:57+08'::timestamptz,
    '2026-07-15 21:15:57+08'::timestamptz
  )
  ON CONFLICT DO NOTHING;

  -- The eight-leg loss campaign has unique legs 3-8. Use the nearest surviving
  -- copy of legs 1-2 from the same journal batch, leaving any duplicate pair for
  -- the two-leg profit campaign below.
  WITH loss_anchor AS (
    SELECT j.created_at
    FROM public.trade_journals j
    WHERE j.user_id = recovered_user_id
      AND upper(replace(j.symbol, '/', '')) = 'FISUSDT'
      AND j.campaign_id IS NULL
      AND j.leg_sequence = 3
      AND j.leg_role = 'hedge_initial_a'
      AND abs(j.pre_entry_price - 0.119986) < 0.0000005
    ORDER BY j.created_at DESC
    LIMIT 1
  ),
  loss_candidates AS (
    SELECT
      j.id,
      j.leg_sequence,
      row_number() OVER (
        PARTITION BY j.leg_sequence
        ORDER BY
          abs(extract(epoch FROM (j.created_at - a.created_at))),
          j.id
      ) AS candidate_rank
    FROM public.trade_journals j
    CROSS JOIN loss_anchor a
    WHERE j.user_id = recovered_user_id
      AND upper(replace(j.symbol, '/', '')) = 'FISUSDT'
      AND j.campaign_id IS NULL
      AND (
        (j.leg_sequence = 1 AND j.leg_role = 'main_open' AND abs(j.pre_entry_price - 0.125946) < 0.0000005)
        OR (j.leg_sequence = 2 AND j.leg_role = 'mirror_tp' AND abs(j.pre_entry_price - 0.125946) < 0.0000005)
        OR (j.leg_sequence = 3 AND j.leg_role = 'hedge_initial_a' AND abs(j.pre_entry_price - 0.119986) < 0.0000005)
        OR (j.leg_sequence = 4 AND j.leg_role = 'hedge_initial_b' AND abs(j.pre_entry_price - 0.119986) < 0.0000005)
        OR (j.leg_sequence = 5 AND j.leg_role = 'hedge_rolling' AND abs(j.pre_entry_price - 0.128985) < 0.0000005)
        OR (j.leg_sequence = 6 AND j.leg_role = 'main_add_1' AND abs(j.pre_entry_price - 0.127227) < 0.0000005)
        OR (j.leg_sequence = 7 AND j.leg_role = 'hedge_rolling' AND abs(j.pre_entry_price - 0.123985) < 0.0000005)
        OR (j.leg_sequence = 8 AND j.leg_role = 'hedge_rolling' AND abs(j.pre_entry_price - 0.123987) < 0.0000005)
      )
  )
  UPDATE public.trade_journals j
  SET campaign_id = loss_campaign_id
  FROM loss_candidates c
  WHERE j.id = c.id
    AND c.candidate_rank = 1
    AND EXISTS (
      SELECT 1
      FROM public.trade_campaigns target
      WHERE target.id = loss_campaign_id
        AND target.deleted_at IS NOT NULL
    );

  -- Reattach the remaining exported main/TP pair to the profit campaign. The
  -- anchor keeps both rows from the same surviving duplicate batch.
  WITH profit_anchor AS (
    SELECT j.created_at
    FROM public.trade_journals j
    WHERE j.user_id = recovered_user_id
      AND upper(replace(j.symbol, '/', '')) = 'FISUSDT'
      AND j.campaign_id IS NULL
      AND j.leg_sequence = 1
      AND j.leg_role = 'main_open'
      AND abs(j.pre_entry_price - 0.125946) < 0.0000005
    ORDER BY j.created_at DESC
    LIMIT 1
  ),
  profit_candidates AS (
    SELECT
      j.id,
      j.leg_sequence,
      row_number() OVER (
        PARTITION BY j.leg_sequence
        ORDER BY
          abs(extract(epoch FROM (j.created_at - a.created_at))),
          j.id
      ) AS candidate_rank
    FROM public.trade_journals j
    CROSS JOIN profit_anchor a
    WHERE j.user_id = recovered_user_id
      AND upper(replace(j.symbol, '/', '')) = 'FISUSDT'
      AND j.campaign_id IS NULL
      AND (
        (j.leg_sequence = 1 AND j.leg_role = 'main_open' AND abs(j.pre_entry_price - 0.125946) < 0.0000005)
        OR (j.leg_sequence = 2 AND j.leg_role = 'mirror_tp' AND abs(j.pre_entry_price - 0.125946) < 0.0000005)
      )
  )
  UPDATE public.trade_journals j
  SET campaign_id = profit_campaign_id
  FROM profit_candidates c
  WHERE j.id = c.id
    AND c.candidate_rank = 1
    AND EXISTS (
      SELECT 1
      FROM public.trade_campaigns target
      WHERE target.id = profit_campaign_id
        AND target.deleted_at IS NOT NULL
    );

  -- Preserve the exact loss total from the export; use surviving journal totals
  -- for the profit campaign when those records are still available.
  UPDATE public.trade_campaigns c
  SET final_realized_pnl = totals.realized_pnl
  FROM (
    SELECT j.campaign_id, sum(j.post_realized_pnl) AS realized_pnl
    FROM public.trade_journals j
    WHERE j.campaign_id = profit_campaign_id
      AND j.post_realized_pnl IS NOT NULL
    GROUP BY j.campaign_id
  ) totals
  WHERE c.id = totals.campaign_id
    AND c.deleted_at IS NOT NULL;
END
$$;

NOTIFY pgrst, 'reload schema';
