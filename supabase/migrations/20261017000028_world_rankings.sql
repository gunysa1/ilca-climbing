-- World Climbing world-ranking position per climber, season and discipline, used by the ILCA 2027
-- criteria. Filled by tools/ifsc/world_ranking.py. Public read, admin write (like international_results).
create table public.world_rankings (
  climber_id uuid not null references public.profiles(id) on delete cascade,
  season     text not null check (season ~ '^\d{4}-\d{2}$'),
  discipline text not null check (discipline in ('boulder', 'lead')),
  position   int  not null check (position > 0),
  as_of      date not null,
  primary key (climber_id, season, discipline)
);

alter table public.world_rankings enable row level security;
create policy world_rankings_read on public.world_rankings for select using (true);
create policy world_rankings_admin on public.world_rankings for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
revoke all on public.world_rankings from anon, authenticated;
grant select on public.world_rankings to anon, authenticated;
grant insert, update, delete on public.world_rankings to authenticated;
