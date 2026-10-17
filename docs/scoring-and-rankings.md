# Scoring and rankings

Every rule here exists in SQL (the views in `supabase/migrations/`) and, where pages compute live, in
TypeScript (`src/lib/scoring.ts`, `src/lib/lead.ts`, `src/lib/rankings.ts`). Tests on both sides use
the same cases.

## Boulder: IFSC 2025 (`ifsc2025`, the default)

- Per boulder: **top = 25 points, zone = 10 points, minus 0.1 for each attempt before the one that
  scored** (never below 0). A top on the 3rd attempt = 24.8; a zone on the 12th = 8.9.
- Round: total points, higher is better.
- Ties: countback to the previous-round place, then fewer attempts to tops, then fewer attempts to
  zones; remaining ties share the rank.
- Climbers without any attempt are not ranked ("–") and don't advance.
- Qualification groups are ranked separately; advancement takes the top of each group.

Checked against official IFSC 2026 results and the temporary ILCA app's code
([reference-analysis.md](reference-analysis.md)).

## Boulder: classic (`classic`, older rounds)

Tops, then zones, then fewer attempts to tops, then fewer attempts to zones; **in a final**, then
countback to the previous round. Rounds imported from LogLig that only publish per-round totals
("2T 3Z 3 5") are stored in `round_totals` and ranked the same way. Countback only in finals is how
LogLig ranked them (10,775 of 10,828 imported ranks identical; countback in every round: 10,731).

## Lead (`lead`)

- Height per route: TOP above every hold, "hold+" (a controlled move past the hold) above "hold".
- **One route**: higher is better; then countback; **in a final**, then the faster climbing time
  (IFSC rule). `rounds.time_tiebreak` turns the time rule off for the three imported 2022-23 LogLig
  finals that left such ties standing.
- **Several routes**: per route, climbers get rank points (tied climbers share the average of the
  places they cover); the round score is the geometric mean of the route rank points, lower is
  better; then countback.

## Places in a competition

A climber's place in an event is decided by the deepest round they reached, then their rank in it
(IFSC overall result). Where LogLig split an event into categories per stage (qualification groups
in "מוקדמות גברים - קבוצה 1/2", then "גברים" for the later rounds), a category whose climbers all
appear in another category of the same event counts as a later stage of it.

## Seasons

An ILCA season runs **September to August** ("2025-26"), like ILCA's own LogLig season folders.
Competitions store their season; `src/lib/season.ts` derives it from the date otherwise.

## National rankings (מדרג לאומי)

Source: ILCA, *אמות מידה לקבלה לנבחרות ישראל בטיפוס לשנת 2025* (criteria for the 2025 national
teams). Computed in `src/lib/rankings.ts` from `season_ranking_rounds()`, `season_age_classes()`,
`international_results` and `ranking_adjustments`. Each competition's **series** says which ranking
it feeds: premier league, U17 league, Israeli championship, youth championship, or none.

### Event points (table 4)

| Place | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21-30 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Points | 100 | 80 | 65 | 55 | 51 | 47 | 43 | 40 | 37 | 34 | 31 | 28 | 26 | 24 | 22 | 20 | 18 | 16 | 14 | 12 | 10 … 1 |

Tied climbers share the average of the points of the places they cover (2 decimals). The Israeli
championship and the youth championship count **double**.

### Seniors (per discipline and gender)

**Israeli championship points + the best 2 of** the premier-league events and the international
senior events. International points (only in the top 60% of the field):

| Event | Top 40 | Top 30 | Semi-final | Final | Podium |
|---|---|---|---|---|---|
| World Cup | 60 | 100 | 140 (boulder 1-20, lead 1-26) | 200 (boulder 1-6, lead 1-8) | 300 |
| European Cup | | | | 60 (1-8) | 100 |
| European Championships | | 60 | 100 (1-24) | 140 (1-8) | 200 |
| World Championships | 0 for now: they earn points, but ILCA's table for them isn't known yet | | | | |

### Youth U21 / U19 / U17

- League: each premier-league event re-ranked among the climbers of the age class (U17: the U17
  league and open events that include U17); the best 2 count.
- Plus the youth championship (the class's category, double points).
- Plus **every** international youth bonus (top half of a field of at least 30):

| Event | Semi-final | Final | Podium |
|---|---|---|---|
| European Youth Cup | | 20 | 30 |
| European Youth Championships | 20 | 30 | 40 |
| World Youth Championships | 30 | 40 | 50 |

Age classes by birth year, E = the season's end year: U21 = E-20…E-19, U19 = E-18…E-17,
U17 = E-16…E-15.

### Ties, listing, adjustments

- Equal totals: the better (youth) championship place ranks higher; otherwise the rank is shared.
- Only climbers with more than 0 points are listed.
- Admin adjustments (e.g. disciplinary deductions published by ILCA) are added last.
- International results are entered by admins (place, field size, last round reached, or the
  points as ILCA published them); nothing is imported from IFSC.
- Seniors are ranked from 2023-24 on; youth from 2024-25 on (earlier youth leagues were organised
  differently).

### Validation

- The criteria document's three worked examples (370, 300, 270 points) are unit tests.
- ILCA's published 2023-24 senior bouldering ranking: all 41 men identical; lead (men and women)
  identical apart from two-point tie differences; women within a few points from the 6th place on
  (a 2024 championship semifinal tie ILCA ordered by hand).
- ILCA's published 2024-25 youth bouldering ranking (31.01.25): identical apart from the
  disciplinary deductions in its footnotes.
