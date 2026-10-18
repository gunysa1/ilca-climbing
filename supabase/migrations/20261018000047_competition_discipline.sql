-- A competition's discipline (boulder / lead / speed), chosen when the admin creates it. It names the
-- problems in the admin and judge screens (boulders or routes), sets the scoring new rounds default to, and
-- lists a competition under its discipline in the viewer before it has rounds. Null on old rows the backfill
-- cannot place; the clients then fall back to the rounds' scoring formats.
--
-- Access: competitions has table-level grants (select for anon/authenticated, writes for authenticated) and
-- the competitions_read / competitions_admin policies, so the new column is read by everyone who reads the row
-- and written only by admins. No grant changes needed.

alter table public.competitions
  add column discipline text check (discipline in ('boulder', 'lead', 'speed'));

comment on column public.competitions.discipline is
  'boulder | lead | speed; null for old rows whose rounds mix formats (or have none) and whose name does not say';

-- Backfill, once. The admin log would record every row as an anonymous edit: keep it out. The rankings cache
-- triggers mark every season for a rebuild (a statement on competitions); harmless, the payload is unchanged.
alter table public.competitions disable trigger admin_log;

-- 1. From the rounds: all lead -> lead; all boulder formats -> boulder; mixed or none -> left null.
update public.competitions co
set discipline = f.discipline
from (
  select c.competition_id,
         case when bool_and(r.scoring = 'lead') then 'lead'
              when bool_and(r.scoring <> 'lead') then 'boulder' end as discipline
  from public.categories c join public.rounds r on r.category_id = c.id
  group by c.competition_id
) f
where f.competition_id = co.id and f.discipline is not null and co.discipline is null;

-- 2. Still unknown: from the name (Hebrew or English), when it names exactly one discipline.
update public.competitions co
set discipline = n.discipline
from (
  select id, (array_remove(array[
           case when txt ~* '(הובלה|\mlead\M)' then 'lead' end,
           case when txt ~* '(בולדר|\mboulder)' then 'boulder' end,
           case when txt ~* '(מהירות|\mspeed\M)' then 'speed' end], null))[1] as discipline,
         cardinality(array_remove(array[
           case when txt ~* '(הובלה|\mlead\M)' then 'lead' end,
           case when txt ~* '(בולדר|\mboulder)' then 'boulder' end,
           case when txt ~* '(מהירות|\mspeed\M)' then 'speed' end], null)) as hits
  from (select id, concat_ws(' ', name, name_he) as txt from public.competitions where discipline is null) x
) n
where n.id = co.id and n.hits = 1;

alter table public.competitions enable trigger admin_log;
