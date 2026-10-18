-- favorites_live(): what the viewer's alerts for starred climbers need, and nothing older.
-- favorites_page() / climber_history_for() recompute every round a climber ever started (seasons of
-- history), which is far too heavy to run every minute for every open viewer on an event day. This
-- returns only the starred climbers' rounds in competitions that are on right now (a live round, or
-- dates from yesterday through tomorrow), with the history columns plus:
--   full_name(_he)  the climber's public name (the alerts show it)
--   own          the climber's own result as text: boulder "tops|zones|top attempts|zone attempts",
--                lead the heights per route ("12+,T"), so an alert fires on the climber's own change only
--   first_round  true when no earlier round (qualification, then semifinal) exists in the category
--                (the first round's start list is the registration, not an advance)
-- Security invoker, like the other public reads: RLS decides what anon sees (no draft competitions).
-- At most 200 climbers.
create function public.favorites_live(p_climbers uuid[]) returns json
  language plpgsql stable security invoker set search_path = public set jit = off as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  cl uuid[] := coalesce(p_climbers[1:200], '{}');
  ids uuid[];
begin
  select array_agg(distinct r.id) into ids
  from public.round_starters s
  join public.rounds r on r.id = s.round_id
  join public.categories c on c.id = r.category_id
  join public.competitions co on co.id = c.competition_id
  where s.climber_id = any(cl) and co.status <> 'draft'
    and ((co.ends_on >= today - 1 and co.starts_on <= today + 1)
         or exists (select 1 from public.rounds r2 join public.categories c2 on c2.id = r2.category_id
                    where c2.competition_id = co.id and r2.status = 'live'));
  ids := coalesce(ids, '{}');  -- null would mean "every round" to lead_scores_for
  return coalesce((
    select json_agg(row_to_json(q)) from (
      select x.climber_id, p.full_name, p.full_name_he, co.id as competition_id, co.name as competition, co.name_he as competition_he, co.starts_on,
             c.name as category, c.name_he as category_he, r.kind as round, r.status as round_status,
             x.tops, x.zones, x.top_attempts, x.zone_attempts, x.points::numeric(6,1) as points, x.rank,
             (select count(*) from public.round_starters s2 where s2.round_id = r.id) as starters,
             r.scoring::text as discipline, r.id as round_id,
             not exists (select 1 from public.rounds r3 where r3.category_id = r.category_id
                         and (case r3.kind when 'qualification' then 0 when 'semifinal' then 1 else 2 end)
                           < (case r.kind when 'qualification' then 0 when 'semifinal' then 1 else 2 end)) as first_round,
             case when r.scoring::text = 'lead' then
               (select string_agg(case when lr.top then 'T' else coalesce(lr.hold, 0)::text || case when lr.plus then '+' else '' end end, ',' order by b.number)
                from public.lead_results lr join public.boulders b on b.id = lr.boulder_id
                where lr.round_id = r.id and lr.climber_id = x.climber_id)
             else concat_ws('|', x.tops, x.zones, x.top_attempts, x.zone_attempts) end as own
      from (
        select sc.climber_id, sc.round_id, sc.tops, sc.zones, sc.top_attempts, sc.zone_attempts, sc.points, sc.rank
        from public.round_scores sc where sc.round_id = any(ids) and sc.climber_id = any(cl)
        union all
        select l.climber_id, l.round_id, null, null, null, null, null, l.rank
        from public.lead_scores_for(ids) l where l.climber_id = any(cl)
      ) x
      join public.rounds r on r.id = x.round_id
      join public.categories c on c.id = r.category_id
      join public.competitions co on co.id = c.competition_id
      join public.profiles p on p.id = x.climber_id
    ) q), '[]'::json);
end $$;
revoke execute on function public.favorites_live(uuid[]) from public;
grant execute on function public.favorites_live(uuid[]) to anon, authenticated;
