-- Archive blobs use immutable names. Keep the v1 deleted head readable by
-- older clients, but reject any later attempt to put its body back.
create or replace function public.guard_retired_quality_monitor_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  archive_key text := pg_catalog.split_part(new.key, '#', 1);
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text || ':' || archive_key, 0));
  if exists (
    select 1 from public.user_sim_state as head
    where head.user_id = new.user_id and head.key = archive_key
      and head.value->>'permanent' = 'true'
  ) and not coalesce((
    new.key = archive_key and new.value->>'deleted' = 'true'
      and new.value->>'permanent' = 'true' and new.value->>'parts' = '0'
  ), false) then
    raise exception using errcode = '23514', message = 'This monitoring archive has been permanently deleted';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_retired_quality_monitor_archive() from public, anon, authenticated;

create trigger guard_retired_quality_monitor_archive
before insert or update on public.user_sim_state
for each row
when (left(new.key, 25) = 'idb:fish-quality-archive/')
execute function public.guard_retired_quality_monitor_archive();

create or replace function public.purge_quality_monitor_archives(p_owner uuid, p_archive_ids text[], p_expected_revisions text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  archive_id text;
  archive_key text;
  deleted_ms bigint;
  expected_rev text;
  actual_head jsonb;
begin
  if owner_id is null or owner_id is distinct from p_owner then
    raise exception using errcode = '42501', message = 'Monitoring archive owner mismatch';
  end if;
  if p_archive_ids is null or cardinality(p_archive_ids) > 512 or
     cardinality(p_expected_revisions) is distinct from cardinality(p_archive_ids) or exists (
    select 1 from pg_catalog.unnest(p_archive_ids) as id
    where id is null or id !~ '^(monitor-archive|monitor-round-snapshot-monitor)-[0-9]+-[0-9]+-[a-z0-9]+$'
       or length(id) > 125
  ) then
    raise exception using errcode = '22023', message = 'Invalid monitoring archive IDs';
  end if;
  for archive_id,expected_rev in
    select distinct id,rev from rows from (pg_catalog.unnest(p_archive_ids), pg_catalog.unnest(p_expected_revisions)) as entries(id,rev)
    order by id,rev
  loop
    archive_key := 'idb:fish-quality-archive/' || archive_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text || ':' || archive_key, 0));
    select value into actual_head from public.user_sim_state
      where user_id = owner_id and key = archive_key;
    if (actual_head->>'permanent') is distinct from 'true'
        and ((actual_head->>'rev') is distinct from expected_rev or exists (
          select 1 from public.user_sim_state as fragment
          where fragment.user_id = owner_id and fragment.key like archive_key || '#%'
            and (expected_rev is null or (fragment.value->>'rev') is distinct from expected_rev)
        )) then
      raise exception using errcode = '40001', message = 'Monitoring archive revision changed';
    end if;
    deleted_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    insert into public.user_sim_state(user_id, key, value, updated_at)
    values (owner_id, archive_key, pg_catalog.jsonb_build_object(
      'v', 1, 'deleted', true, 'permanent', true, 'parts', 0, 'savedAt', deleted_ms,
      'enc', 'json', 'bytes', 0, 'rev', 'purged-' || pg_catalog.gen_random_uuid()::text
    ), clock_timestamp())
    on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at
      where (public.user_sim_state.value->>'permanent') is distinct from 'true';
    delete from public.user_sim_state
    where user_id = owner_id and key like archive_key || '#%';
  end loop;
end;
$$;
revoke execute on function public.purge_quality_monitor_archives(uuid, text[], text[]) from public, anon;
grant execute on function public.purge_quality_monitor_archives(uuid, text[], text[]) to authenticated;
notify pgrst, 'reload schema';
