# Ranking criteria editions (2026-27 and later)

## Goal

The national rankings follow the ILCA criteria document that applies to each season. Today the code
implements one document (criteria for 2025, used for 2024-25). ILCA's criteria for 2027 (April 2026)
govern 2026-27 and change how international results count. Each document becomes an **edition** in
code; a season maps to one edition; a new document is a new edition plus tests from its examples.

## Editions

| Edition | Document | Seasons |
|---|---|---|
| `ilca2025` | אמות מידה לקבלה לנבחרות ישראל בטיפוס לשנת 2025 (Dec 2024) | 2023-24, 2024-25, 2025-26 (assumed: the 2026 document was not available) |
| `ilca2027` | אמות מידה ... לשנת 2027 (April 2026) | 2026-27 |

Both editions keep: league table 1 (100, 80, 65 … 1 for places 1-30), ties share the average,
Israeli / youth championship counts double, best 2 league events, youth U21/U19 places re-ranked among
the class, senior minimum age (`season_senior_too_young`, IFSC: 16 until 2024, 17 from 2025).

`ilca2027` differs:

- **Seniors:** no points per international event. The climber's **World Climbing world ranking**
  position in the discipline earns 1-10: 400, 11-20: 300, 21-30: 200, 31-40: 100 (table 2). These
  points replace the weaker of the two counted league events when higher (2.6); with fewer than two
  league events they fill the empty slot. Total = championship + best 2 of (league events, world
  ranking). The position is the one set on 1 January within the season (26/27: 1.1.2027); until that
  date the ranking uses the latest position and is marked provisional.
- **Youth bonus:** only World Youth Championships (final 60, podium 100) and European Youth
  Championships (final 40, podium 60) (table 6). No cups, no semifinal points, no field-size condition.
  Podium = final round reached and place 1-3.
- **U17 league:** only U17-league events (2.2.3); open events such as "גברים+ U17" no longer count for U17.
- Points a climber earned the previous season stay with them after moving up a class (2.2.8): with
  international results assigned by calendar year (2026 events → 2026-27) this needs no extra logic.

## Data

- `world_rankings (climber_id, season, discipline, position, as_of)`: public read, admin write (same
  policies as `international_results`), one row per climber, season and discipline.
- Filled by `tools/ifsc/world_ranking.py` from `/api/v1/cuwr/{dcat}?date=YYYY-MM-DD` (dcat: boulder
  men 3, women 7; lead men 1, women 5), ISR athletes matched through `profiles.ifsc_id`.
- IFSC results for 2026 (season 2026-27) are imported with the existing `tools/ifsc` pipeline once
  this ships; under `ilca2027` per-event senior rows show on climber pages but score 0.

## Page

The rankings page names the edition with a link to ILCA's document, says when the edition is assumed
(2025-26), and marks world-ranking points as provisional before 1 January.

## Non-goals

Admin screen for world ranking positions (the tool fills them; admins can fix rows in Supabase);
speed and combined rankings; the team-selection priorities of the criteria.
