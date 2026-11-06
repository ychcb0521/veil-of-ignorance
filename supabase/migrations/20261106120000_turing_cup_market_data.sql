-- Offline imports are written by the ingestion job. App sessions can only read their own rows.
create table public.turing_cup_markets (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (symbol <> '' and symbol = upper(symbol) and symbol not like 'TURING:%'),
  tick_size numeric check (tick_size > 0 and tick_size < 'Infinity'::numeric),
  primary key (user_id, symbol)
);

-- Ingestion materializes supported timeframes from the source's available, complete bars.
create table public.turing_cup_candles (
  user_id uuid not null,
  symbol text not null,
  interval text not null check (interval in ('1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M')),
  open_time bigint not null check (open_time >= 0),
  open numeric not null,
  high numeric not null check (high < 'Infinity'::numeric),
  low numeric not null check (low > 0),
  close numeric not null,
  volume numeric not null check (volume >= 0 and volume < 'Infinity'::numeric),
  quote_volume numeric check (quote_volume >= 0 and quote_volume < 'Infinity'::numeric),
  taker_buy_volume numeric check (taker_buy_volume between 0 and volume),
  taker_buy_quote_volume numeric check (taker_buy_quote_volume is null or (quote_volume is not null and taker_buy_quote_volume between 0 and quote_volume)),
  primary key (user_id, symbol, interval, open_time),
  foreign key (user_id, symbol) references public.turing_cup_markets(user_id, symbol) on delete cascade,
  check (open between low and high and close between low and high)
);

alter table public.turing_cup_markets enable row level security;
alter table public.turing_cup_candles enable row level security;
revoke all on public.turing_cup_markets, public.turing_cup_candles from public, anon, authenticated;
grant select on public.turing_cup_markets, public.turing_cup_candles to authenticated;
grant all on public.turing_cup_markets, public.turing_cup_candles to service_role;
create policy turing_cup_markets_read on public.turing_cup_markets for select to authenticated using ((select auth.uid()) = user_id);
create policy turing_cup_candles_read on public.turing_cup_candles for select to authenticated using ((select auth.uid()) = user_id);

-- With a lower bound, page forwards. For a chart's history request, take the latest rows up to
-- its upper bound and still return them in time order. Preserve prices as decimal strings.
create function public.read_turing_cup_klines(
  p_symbol text, p_interval text, p_start bigint, p_end bigint, p_limit integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with page as (
    (select c.* from public.turing_cup_candles c
      where p_start is not null and c.user_id = (select auth.uid())
        and c.symbol = p_symbol and c.interval = p_interval
        and c.open_time >= p_start and c.open_time <= coalesce(p_end, 9223372036854775807)
      order by c.open_time asc limit least(greatest(p_limit, 1), 1500))
    union all
    (select c.* from public.turing_cup_candles c
      where p_start is null and c.user_id = (select auth.uid())
        and c.symbol = p_symbol and c.interval = p_interval
        and c.open_time <= coalesce(p_end, 9223372036854775807)
      order by c.open_time desc limit least(greatest(p_limit, 1), 1500))
  )
  select coalesce(jsonb_agg(jsonb_build_array(
    open_time, open::text, high::text, low::text, close::text, volume,
    null::bigint, quote_volume, null::bigint, taker_buy_volume, taker_buy_quote_volume
  ) order by open_time), '[]'::jsonb)
  from page;
$$;

create function public.read_turing_cup_tick_size(p_symbol text)
returns numeric language sql stable security invoker set search_path = '' as $$
  select m.tick_size from public.turing_cup_markets m
  where m.user_id = (select auth.uid()) and m.symbol = p_symbol;
$$;

revoke all on function public.read_turing_cup_klines(text,text,bigint,bigint,integer) from public, anon;
revoke all on function public.read_turing_cup_tick_size(text) from public, anon;
grant execute on function public.read_turing_cup_klines(text,text,bigint,bigint,integer) to authenticated;
grant execute on function public.read_turing_cup_tick_size(text) to authenticated;
