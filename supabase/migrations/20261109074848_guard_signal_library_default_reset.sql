create or replace function public.guard_signal_library_default_reset()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(old.value) = 'array' and jsonb_typeof(new.value) = 'array'
     and jsonb_array_length(new.value) > 0
     and exists (select 1 from jsonb_array_elements(old.value) v where v->>'quality' in ('1','2','3','4','5'))
     and not exists (select 1 from jsonb_array_elements(new.value) v
       where coalesce(v->>'id','') not like 'default-%'
          or coalesce(v->>'quality','') in ('1','2','3','4','5')) then
    raise exception using errcode = '23514',
      message = 'An unrated bundled default library cannot replace saved account ratings. Reload the account library before editing.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_signal_library_default_reset() from public, anon, authenticated;
create trigger signal_library_default_reset_guard
before update of value on public.user_sim_state
for each row when (old.key = 'signal_library_v1' and new.key = 'signal_library_v1')
execute function public.guard_signal_library_default_reset();
