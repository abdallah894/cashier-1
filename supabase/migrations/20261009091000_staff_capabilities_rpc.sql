-- Capability grants are an authority change, so they go through one audited
-- RPC instead of direct service-role table writes.
insert into public.audit_actions (action, target_type) values ('capabilities_changed', 'staff');

create or replace function public.set_staff_capabilities(p_staff_id uuid, p_capabilities public.capability[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_role public.user_role;
begin
  if v_actor is null or not public.is_admin() then raise exception 'capabilities: admin only'; end if;
  if p_staff_id = v_actor then raise exception 'capabilities: you cannot change your own'; end if;
  select role into v_role from public.profiles where id = p_staff_id;
  if not found then raise exception 'capabilities: staff not found'; end if;
  if v_role = 'admin' then raise exception 'capabilities: admins already have every capability'; end if;

  delete from public.staff_capabilities where staff_id = p_staff_id;
  insert into public.staff_capabilities (staff_id, capability, granted_by)
  select p_staff_id, c, v_actor from unnest(coalesce(p_capabilities, '{}'::public.capability[])) c group by c;

  perform public.write_audit_event(v_actor, null, 'capabilities_changed', 'staff', p_staff_id,
    jsonb_build_object('item_count', coalesce(array_length(p_capabilities, 1), 0)), null);
end;
$$;
revoke execute on function public.set_staff_capabilities(uuid, public.capability[]) from public, anon;
grant execute on function public.set_staff_capabilities(uuid, public.capability[]) to authenticated, service_role;
