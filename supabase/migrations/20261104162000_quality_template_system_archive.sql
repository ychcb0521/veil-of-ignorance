-- Independent, append-only system archive. Resetting user_sim_state never deletes it.
create table if not exists public.quality_plan_template_archive (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 template_id text not null,
 revision_hash text not null,
 snapshot jsonb not null,
 template_name text generated always as(snapshot->>'name') stored,
 created_at timestamptz not null default now(),
 constraint quality_template_archive_revision unique(user_id,template_id,revision_hash),
 constraint quality_template_archive_snapshot check(jsonb_typeof(snapshot)='object' and snapshot ? 'plan' and snapshot ? 'name')
);
create index if not exists quality_template_archive_owner_date on public.quality_plan_template_archive(user_id,created_at desc,id desc);
alter table public.quality_plan_template_archive enable row level security;
revoke all on public.quality_plan_template_archive from anon,authenticated;
grant select on public.quality_plan_template_archive to authenticated;
drop policy if exists "Owners read template system archive" on public.quality_plan_template_archive;
create policy "Owners read template system archive" on public.quality_plan_template_archive for select to authenticated using(auth.uid()=user_id);

create or replace function public.archive_quality_template_catalog() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb;
begin
 if new.key <> 'quality_plan_templates_v1' or jsonb_typeof(new.value)<>'array' then return new; end if;
 for item in select value from jsonb_array_elements(new.value) loop
  if jsonb_typeof(item)='object' and item ? 'plan' and item ? 'name' and item ? 'id' and coalesce(item->>'deleted','false')<>'true' then
   insert into public.quality_plan_template_archive(user_id,template_id,revision_hash,snapshot)
   values(new.user_id,item->>'id',encode(sha256(convert_to(item::text,'UTF8')),'hex'),item)
   on conflict(user_id,template_id,revision_hash) do nothing;
  end if;
 end loop;
 return new;
end $$;
revoke all on function public.archive_quality_template_catalog() from public;
drop trigger if exists quality_template_catalog_archive on public.user_sim_state;
create trigger quality_template_catalog_archive after insert or update of value on public.user_sim_state for each row when(new.key='quality_plan_templates_v1') execute function public.archive_quality_template_catalog();
comment on table public.quality_plan_template_archive is '用户模板的系统固化版本；普通清理、模板删除、覆盖与交易数据重置不删除此处记录，仅本人可读。';
