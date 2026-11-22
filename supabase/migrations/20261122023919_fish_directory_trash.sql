-- Catalogs contain directory metadata. Signals, trades and frozen templates live outside this namespace.
set local lock_timeout='3s';

create table public.fish_directory_trash (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('mining','filter','screen','monitor')),
  directory_id text not null,
  title text not null,
  directory_at bigint not null,
  state text not null check (state in ('trash','purging','purged')),
  token uuid not null default gen_random_uuid(),
  primary key (user_id,scope,directory_id)
);
alter table public.fish_directory_trash enable row level security;
revoke all on public.fish_directory_trash from public,anon,authenticated;
grant select on public.fish_directory_trash to authenticated;
create policy read_own_directory_trash on public.fish_directory_trash for select to authenticated
  using (user_id=(select auth.uid()));

create function public.fish_directory_catalog_scope(k text) returns text
language sql immutable strict security invoker set search_path='' as $$
  select case when k='idb:fish-quality-recent-directory-v1'
    or starts_with(k,'idb:fish-quality-recent-directory-v1/') or starts_with(k,'idb:fish-quality-directory-v2/') then 'monitor'
    else (regexp_match(k,'^idb:fish-library-browse-v1/(?:full/|recent/)?(mining|screen|filter)(?:/|$)'))[1] end
$$;

create function public.fish_directory_refs(s text, entries jsonb) returns setof text
language sql immutable strict security invoker set search_path='' as $$
  select distinct h from jsonb_array_elements(entries) g
  cross join lateral jsonb_array_elements_text(case when s='monitor' then jsonb_build_array(g->>'bodyId') else g->'pages' end) h
  where (s='monitor' and h ~ '^recent-v1-[a-f0-9]{64}$') or (s<>'monitor' and h ~ '^[a-f0-9]{64}$')
$$;

-- Only remove pages unreferenced across all remaining catalogs of this account.
create function public.prune_fish_directory_refs(u uuid,s text,candidates text[],kept text[] default '{}')
returns text[] language plpgsql security invoker set search_path='' as $$
declare ref text; removed text[] := '{}';
begin
  if cardinality(candidates)=0 then return removed; end if;
  for ref in
    select unnest(candidates) except select unnest(kept)
    except select h from public.user_sim_state c
      cross join lateral public.fish_directory_refs(s,case when s='monitor' then c.value->'entries' else c.value#>'{browse,groups}' end) h
      where c.user_id=u and c.key>='idb:fish-' and c.key<'idb:fish.'
        and (public.fish_directory_catalog_scope(c.key)='monitor')=(s='monitor') and h=any(candidates)
  loop
    if s='monitor' then
      delete from public.user_sim_state where user_id=u and (key='idb:fish-quality-archive/'||ref
        or starts_with(key,'idb:fish-quality-archive/'||ref||'#'));
      removed=array_append(removed,ref);
    else
      delete from public.user_sim_state where user_id=u and key='idb:fish-library-browse-v1/page/'||ref;
    end if;
  end loop;
  return removed;
end $$;
revoke all on function public.prune_fish_directory_refs(uuid,text,text[],text[]) from public,anon,authenticated;

-- Guard publications from older tabs. Stage pages before pointing a new catalog at them.
create function public.guard_fish_directory_catalog() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  s text := public.fish_directory_catalog_scope(new.key);
  path text[] := case when s='monitor' then array['entries'] else array['browse','groups'] end;
  entries jsonb := new.value #> path;
  kept jsonb; removed jsonb; old_refs text[] := '{}';
begin
  if current_setting('role') in ('anon','authenticated') and auth.uid() is distinct from new.user_id then
    raise exception '账号已切换';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fish-directory:'||new.user_id::text,0));
  if not exists(select 1 from public.fish_directory_trash m where m.user_id=new.user_id and m.state='purged'
    and (m.scope='monitor')=(s='monitor')) or jsonb_typeof(entries) is distinct from 'array' then return new; end if;
  select coalesce(jsonb_agg(e order by n) filter(where m.directory_id is null),'[]'::jsonb),
    jsonb_agg(e) filter(where m.directory_id is not null) into kept,removed
    from jsonb_array_elements(entries) with ordinality t(e,n)
    left join public.fish_directory_trash m on m.user_id=new.user_id and m.scope=s and m.directory_id=e->>'id' and m.state='purged';
  if removed is not null then
    perform public.prune_fish_directory_refs(new.user_id,s,array(select public.fish_directory_refs(s,removed)),
      array(select public.fish_directory_refs(s,kept)));
    new.value=jsonb_set(new.value,path,kept);
    if s='monitor' then new.value=jsonb_set(new.value,'{total}',to_jsonb(greatest(jsonb_array_length(kept),
      (new.value->>'total')::int-jsonb_array_length(removed)))); end if;
  end if;
  -- A concurrent publisher might have staged a page just before a purge.
  if tg_op='UPDATE' then old_refs=array(select public.fish_directory_refs(s,old.value #> path)); end if;
  if exists(select from public.fish_directory_refs(s,kept) ref where ref<>all(old_refs)
    and not exists(select from public.user_sim_state c where c.user_id=new.user_id and c.key=
      (case when s='monitor' then 'idb:fish-quality-archive/' else 'idb:fish-library-browse-v1/page/' end)||ref))
    then raise exception '目录归档页已变更，请重新发布'; end if;
  return new;
end $$;
create trigger guard_fish_directory_catalog before insert or update on public.user_sim_state
  for each row when (public.fish_directory_catalog_scope(new.key) is not null) execute function public.guard_fish_directory_catalog();

create function public.change_fish_directory(p_owner uuid,p_scope text,p_id text,p_title text,
  p_at bigint,p_action text,p_token uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid := auth.uid(); m public.fish_directory_trash%rowtype;
  catalog record; refs text[] := '{}'; removed_bodies text[] := '{}'; path text[]; keep jsonb; old_entries jsonb;
begin
  if u is null or u is distinct from p_owner then raise exception '账号已切换'; end if;
  if p_scope is null or p_scope not in ('filter','screen','monitor','mining') or coalesce(length(p_id),0) not between 1 and 1024
    or p_action is null or p_action not in ('trash','restore','begin','retain','finish') then raise exception '目录操作无效'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fish-directory:'||u::text,0));
  select * into m from public.fish_directory_trash where user_id=u and scope=p_scope and directory_id=p_id for update;
  if p_action='trash' then
    if found or p_token is not null or p_at is null or coalesce(length(p_title),0) not between 1 and 1024 then raise exception '目录状态已更新，请重新打开'; end if;
    insert into public.fish_directory_trash(user_id,scope,directory_id,title,directory_at,state)
      values(u,p_scope,p_id,p_title,p_at,'trash') returning * into m;
  else
    if not found or m.token is distinct from p_token then raise exception '目录状态已更新，请重试'; end if;
    if p_action='restore' and m.state='trash' then
      delete from public.fish_directory_trash where user_id=u and scope=p_scope and directory_id=p_id;
      return jsonb_build_object('state','active');
    elsif (p_action='begin' and m.state='trash') or (p_action='retain' and m.state='purging') then
      update public.fish_directory_trash set state=case p_action when 'begin' then 'purging' else 'trash' end,token=gen_random_uuid()
        where user_id=u and scope=p_scope and directory_id=p_id returning * into m;
    elsif p_action='finish' and m.state='purging' then
      path=case when p_scope='monitor' then array['entries'] else array['browse','groups'] end;
      for catalog in select key,value from public.user_sim_state where user_id=u and key>='idb:fish-' and key<'idb:fish.'
        and public.fish_directory_catalog_scope(key)=p_scope and (value #> path) @> jsonb_build_array(jsonb_build_object('id',p_id)) for update loop
        old_entries=catalog.value #> path;
        refs=refs||array(select h from jsonb_array_elements(old_entries) e
          cross join lateral public.fish_directory_refs(p_scope,jsonb_build_array(e)) h where e->>'id'=p_id);
        select coalesce(jsonb_agg(e order by n),'[]'::jsonb) into keep from jsonb_array_elements(old_entries) with ordinality x(e,n)
          where e->>'id' is distinct from p_id;
        catalog.value=jsonb_set(catalog.value,path,keep);
        if p_scope='monitor' then catalog.value=jsonb_set(catalog.value,'{total}',to_jsonb(greatest(jsonb_array_length(keep),
          (catalog.value->>'total')::int-jsonb_array_length(old_entries)+jsonb_array_length(keep)))); end if;
        update public.user_sim_state set value=catalog.value,updated_at=now() where user_id=u and key=catalog.key;
      end loop;
      removed_bodies=public.prune_fish_directory_refs(u,p_scope,refs);
      update public.fish_directory_trash set state='purged',title='',token=gen_random_uuid()
        where user_id=u and scope=p_scope and directory_id=p_id returning * into m;
    else raise exception '当前目录不能执行此操作'; end if;
  end if;
  return jsonb_build_object('state',m.state,'token',m.token,'bodies',removed_bodies);
end $$;
revoke all on function public.change_fish_directory(uuid,text,text,text,bigint,text,uuid) from public,anon;
grant execute on function public.change_fish_directory(uuid,text,text,text,bigint,text,uuid) to authenticated;
revoke all on function public.guard_fish_directory_catalog() from public,anon,authenticated;
-- Mining and screening pages depend on their own ledgers. The only research
-- data used by these two projections is the directory visibility/name map.
-- After a purge changes the research revision, reuse pages only when *both*
-- their ledger revisions and the applicable visibility metadata still agree.
create function public.read_fish_catalog_after_purge(p_owner uuid,p_scope text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  u uuid := auth.uid(); keys text[]; revisions jsonb; head text; past text;
  before_edits jsonb; after_edits jsonb; candidate jsonb;
begin
  if u is null or u is distinct from p_owner or p_scope not in ('mining','screen') then return null; end if;
  if not exists(select 1 from public.fish_directory_trash where user_id=u and scope in ('filter','monitor')
    and state in ('purged','purging')) then return null; end if;
  keys=case p_scope when 'mining' then array['idb:fish-mining-library','idb:fish-mining-deletions-v1']
    else array['idb:pre-entry-monitor-v5','idb:pre-entry-table-clears-v1'] end;
  select jsonb_object_agg(k,coalesce(c.value->>'rev','')) into revisions from unnest(keys||array['idb:fish-quality']) k
    left join public.user_sim_state c on c.user_id=u and c.key=k having not coalesce(bool_or(c.value->>'deleted'='true'),false);
  head=revisions->>'idb:fish-quality';
  if coalesce(head,'')='' or coalesce(revisions->>keys[1],'')='' then return null; end if;
  select coalesce(value->'edits','{}'::jsonb) into after_edits from public.user_sim_state where user_id=u and key in
    ('idb:fish-quality-directory-v2/'||head,'idb:fish-quality-recent-directory-v1/'||head)
    and value->>'owner'=u::text and value->>'sourceRevision'=head and value->>'version'='1' order by key limit 1;
  if jsonb_typeof(after_edits) is distinct from 'object' then return null; end if;
  for candidate in select value->'browse' from public.user_sim_state where user_id=u
    and key>='idb:fish-library-browse-v1/' and key<'idb:fish-library-browse-v10'
    and public.fish_directory_catalog_scope(key)=p_scope and value#>>'{browse,owner}'=u::text and value#>>'{browse,scope}'=p_scope
    and value#>>'{browse,version}'='1' and (value#>'{browse,revisions}')-'idb:fish-quality'=revisions-'idb:fish-quality'
    order by (value#>>'{browse,recent}'='true') is true,updated_at desc loop
    past=candidate#>>'{revisions,idb:fish-quality}';
    select coalesce(value->'edits','{}'::jsonb) into before_edits from public.user_sim_state where user_id=u and key in
      ('idb:fish-quality-directory-v2/'||past,'idb:fish-quality-recent-directory-v1/'||past)
      and value->>'owner'=u::text and value->>'sourceRevision'=past and value->>'version'='1' order by key limit 1;
    if jsonb_typeof(before_edits)='object' and not exists (
      select from jsonb_each(before_edits) old_e full join jsonb_each(after_edits) new_e on new_e.key=old_e.key
      where old_e.value is distinct from new_e.value and (p_scope='screen' or starts_with(coalesce(new_e.key,old_e.key),'mining-family-'))
      and (new_e.value->>'hidden' is distinct from 'true' or candidate->'groups' @> jsonb_build_array(jsonb_build_object('id',new_e.key)))
    ) then return jsonb_set(candidate,'{revisions}',revisions); end if;
  end loop;
  return null;
end $$;
revoke all on function public.read_fish_catalog_after_purge(uuid,text) from public,anon;
grant execute on function public.read_fish_catalog_after_purge(uuid,text) to authenticated;
notify pgrst,'reload schema';
