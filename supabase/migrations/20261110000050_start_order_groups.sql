-- Start-list tools: move one starter to a place in the start order, and split a round's starters into groups by
-- start order. Both are admin-only: RLS (starters_admin) alone would just update 0 rows for others, so they raise.
-- Every changed row is logged by the admin_log trigger on round_starters (migration 049).

create function public.move_starter(p_round uuid, p_climber uuid, p_position int) returns void
  language plpgsql security invoker set search_path = public as $$
declare n int; pos int;
begin
  if not public.has_role('admin') then
    raise exception 'only an admin changes the start order' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from round_starters where round_id = p_round and climber_id = p_climber) then
    raise exception 'climber % is not a starter of round %', p_climber, p_round;
  end if;
  select count(*) into n from round_starters where round_id = p_round;
  pos := greatest(1, least(coalesce(p_position, 1), n));
  -- the others keep their relative order; the climber slots in at pos
  update round_starters s set start_order = x.new_order
  from (
    select climber_id,
           case when climber_id = p_climber then pos
                else rn + case when rn >= pos then 1 else 0 end end as new_order
    from (
      select climber_id, row_number() over (order by start_order, climber_id) as rn
      from round_starters where round_id = p_round and climber_id <> p_climber
    ) o
    union all select p_climber, pos
  ) x
  where s.round_id = p_round and s.climber_id = x.climber_id and s.start_order is distinct from x.new_order;
end $$;

create function public.split_groups(p_round uuid, p_labels text[] default array['A','B']) returns int
  language plpgsql security invoker set search_path = public as $$
declare n int := coalesce(cardinality(p_labels), 0); cnt int;
begin
  if not public.has_role('admin') then
    raise exception 'only an admin changes the groups' using errcode = 'insufficient_privilege';
  end if;
  update round_starters s set group_label = case when n = 0 then null else p_labels[(x.k - 1) % n + 1] end
  from (select climber_id, row_number() over (order by start_order, climber_id) as k
        from round_starters where round_id = p_round) x
  where s.round_id = p_round and s.climber_id = x.climber_id;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

revoke execute on function public.move_starter(uuid, uuid, int) from public, anon;
revoke execute on function public.split_groups(uuid, text[]) from public, anon;
grant execute on function public.move_starter(uuid, uuid, int) to authenticated;
grant execute on function public.split_groups(uuid, text[]) to authenticated;
