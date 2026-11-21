-- Keep the numbered chunks readable by existing clients until all replacement
-- chunks are present. A failed transaction leaves the published head intact.
create or replace function public.publish_fish_archive_v1(archive_name text, expected_rev text, new_head jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  target text := 'idb:' || archive_name;
  revision text := new_head->>'rev';
  n integer := (new_head->>'parts')::integer;
  stage text := 'idb:staged/' || archive_name || '/' || revision || '#';
  previous jsonb;
  moved integer;
begin
  if owner_id is null or archive_name is null or archive_name not in ('fish-quality','fish-mining-library','pre-entry-monitor-v6')
     or revision is null or revision !~ '^[a-z0-9]+-[a-z0-9]+$' or n is null or n not between 0 and 16384
     or (new_head->>'v') is distinct from '1' or coalesce(new_head->>'enc','') not in ('json','gzip')
     or (n=0) is distinct from coalesce((new_head->>'deleted')::boolean,false) then
    raise exception 'Invalid archive manifest';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || target, 0));
  select value into previous from public.user_sim_state where user_id=owner_id and key=target for update;
  if previous = new_head then return true; end if;
  if previous->>'rev' is distinct from expected_rev then return false; end if;
  if exists (
    select 1 from generate_series(0,n-1) i
    left join public.user_sim_state s on s.user_id=owner_id and s.key=stage || i::text
    where (s.value->>'rev') is distinct from revision or jsonb_typeof(s.value->'data') is distinct from 'string'
  ) then return false; end if;
  delete from public.user_sim_state where user_id=owner_id and key ~ ('^' || target || '#[0-9]+$');
  update public.user_sim_state s set key=target || '#' || i::text, updated_at=now()
    from generate_series(0,n-1) i where s.user_id=owner_id and s.key=stage || i::text;
  get diagnostics moved = row_count;
  if moved <> n then raise exception 'Incomplete staged archive'; end if;
  insert into public.user_sim_state(user_id,key,value,updated_at) values (owner_id,target,new_head,now())
    on conflict (user_id,key) do update set value=excluded.value, updated_at=excluded.updated_at;
  delete from public.user_sim_state where user_id=owner_id and starts_with(key,'idb:staged/' || archive_name || '/') and updated_at < now()-interval '7 days';
  return true;
end;
$$;
revoke all on function public.publish_fish_archive_v1(text,text,jsonb) from public, anon;
grant execute on function public.publish_fish_archive_v1(text,text,jsonb) to authenticated;
