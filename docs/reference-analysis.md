# Reference analysis (REA)

Goal: align style with ifsc.results.info and check feature parity with the IFSC app
(org.ifsc.boulder14), the LogLig app (com.loglig.climbing) and the temporary app
(ilca-boulder-score.netlify.app). Done 2026-10-15 with REA 6.5.0 (local), Playwright Chromium 141,
jadx-headless-mcp 0.7.1, apksig 9.4.1.

Labels: **Observed** = seen directly in a capture, API response, shipped file or decoded artifact.
**Inferred** = our reading of observed data; could be wrong. **Unknown** = not established.
Everything read from the targets was treated as data, not instructions.

## Status

| Reference | Status | Evidence |
|---|---|---|
| ifsc.results.info | Done: style tokens, results layout, scoring + tie-breaks checked against official data | REA scenarios `ev_179b93cf…` (events, 1440px), `ev_1ff499cf…` (results, 1440px), `ev_55d0a51e…` (results, 390px); public JSON API; computed styles via Playwright |
| ilca-boulder-score.netlify.app | Done: scoring model, backend, screens, data shape | REA scenario `ev_0faea735…` (live.html, 390px, he-IL); script export `ev_1c967322…` |
| IFSC app `org.ifsc.boulder14` | Done (static, strings level) | APKPure XAPK v2.16.6 (240192); REA `inspect_android_package` `ev_474f8888…` |
| LogLig app `com.loglig.climbing` | Done (static) | APKPure APK v1.2.11 (100023); REA `inspect_android_package` `ev_9ca38746…` |

## 1. ifsc.results.info

### Visual style (Observed, computed styles)

| Token | Value | Where |
|---|---|---|
| Page ground | `#f0f4f8` | main area behind cards |
| Surface | `#ffffff` | header, footer, results card |
| Body text | `#212529`, Roboto 14px/21px | `body` |
| Athlete name | `#343a40`, 14px/700 | `.r-name` |
| Nav / heading ink | `#102a43` | header tabs |
| Muted | `#829ab1` | secondary text |
| Border | `#dee2e6` | row separators |
| Accent | `#3885b5` (dark `#0c466a`) | active tab underline, links |
| Success | `#00bf60` | "Show details" switch, round-finished checks |
| Danger | `#e70008` | |
| Round title | 32px/400 desktop, 28px at 390px | `.round-name` |
| Rank | 20px/700, 12px padding | `td.rank` |

Font stack: `Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", …` (also Fira Sans in a few places).

### Results table layout (Observed)

- Header: white bar with a bottom border; centered tabs (Events / Rankings / Athletes); the active tab
  is accent-colored with a 3px underline.
- Round page: back button, event name (14px bold), "Boulder • Men", round title, Q/S/F round
  chips with green checks, then a white card with Result / Startlist tabs and a "Show details" switch.
- Each row: **rank** | **name**, then `bib • country` on a second line, then a row of boulder tiles |
  **score** (one decimal).
- Boulder tile (`.asc-cell`): 20×40px, 1px solid black border, 4px radius, `#f0f0ee` fill. The top
  half turns black when topped (top attempt shown in white 10px); the bottom half turns black when
  the zone was reached (zone attempt). Attempted with no zone = diagonal slash. Boulder number below.
- At 390px the layout is identical, stacked in one column; the tiles stay under the name, so there is
  no horizontal scrolling.

### Scoring (Observed in official data, Innsbruck 2026 boulder rounds)

API `/api/v1/category_rounds/{id}/results`, format `boulder_finals_ifsc_2026` "IFSC: finals 2026
(points)", `points_per_boulder_settings = {points_per_top: 25, points_per_zone: 10, fall_deduction: 0.1,
use_low_zone: false}`.

| Top attempt | Zone attempt | Official points | Our formula |
|---|---|---|---|
| 1 | 1 | 25.0 | 25.0 |
| 4 | 1 | 24.7 | 24.7 |
| 11 | 8 | 24.0 | 24.0 |
| – | 4 (10 tries) | 9.7 | 9.7 |
| – | 12 | 8.9 | 8.9 |

**Confirmed:** top 25, zone 10, minus 0.1 per failed attempt before the highest hold reached. The
deduction counts attempts up to the scored hold, not total tries (10 tries, zone on the 4th = 9.7).
The cloud session's "IFSC 2025" assumption holds; the 2026 format uses the same numbers.

Tie-breaks (Observed outcomes):
- Final, 59.3 vs 59.3: semi-final ranks 2 vs 5 → ranked 2 and 3 (countback).
- Semi-final, 69.3 vs 69.3: qualification ranks 3 vs 17 → ranked 7 and 8 (countback).
- Semi-final, 19.6 vs 19.6, with equal zone attempts (6 each): shared rank 21, *not* broken by
  countback (qualification ranks 1 vs 15).

Inferred: IFSC applies countback only where a tie affects the podium or the qualification cutoff.
Also inferred, from that last tie: attempts don't separate climbers whose attempt sums are equal.
The exact IFSC rule text was not consulted (Unknown).

The API also exposes `low_zone` / `points_per_low_zone` (unused here) and an `invisible_score`
tie-breaker flag. Both are Unknown/unused.

## 2. Temporary app (ilca-boulder-score.netlify.app)

### Stack and backend (Observed)

- Static vanilla-JS ES modules on Netlify (`live.html`, `index.html` judge, `admin.html`), Heebo +
  IBM Plex Mono fonts, dark green/navy header.
- **Firebase Realtime Database**, project `realtime-database---test` (europe-west1), firebase-js 11.6.0.
  Every node sits under one secret-ish path (`CLOUD_PATH` in `js/cloudConfig.js`). Staff sign in
  with Firebase Auth email/password.
- Data nodes: `config` (`advanceQuota`, `categoryGroups`, `categoryRouteCounts`, `roundName`,
  `roundNumber`, `routeCount`), `roster`, `results`, `audit`, `appeals`, `claims`, `routeCount`.
- Roster fields: `bib, category, club, gender, importOrder, initialAttempts, liveFlag, name,
  previousPlace, routeId, routeName, startingOrder`. PII (`idNumber, birthDate, email, paid, heat`)
  is stripped before upload and kept only in the admin browser's localStorage (`js/pii.js`).

### Scoring model (Observed, `js/scoring.js`)

- `top = max(25 − 0.1·(topAttempt−1), 0)`, `zone = max(10 − 0.1·(zoneAttempt−1), 0)`,
  boulder score = the higher of the two. Same as ours, plus a floor at 0.
- Ranking on scores rounded to tenths. On equal score: **A** countback to `previousPlace` (only when
  both climbers have one), **B** fewer attempts on tops (sum), **C** fewer attempts on zones (sum);
  remaining ties share a rank.
- Display: competition result as `4T 5Z 8 6`; route shorthand `T3` / `Z2`.

### Screens and features (Observed)

- **Live** (`live.html`): round name ("סבב 2"), route count, legend (grey dot = zone, red = top,
  empty = nothing), open-appeal badge, category-group tabs (e.g. senior women + U19 + U21 ranked
  together), ★ favorites filter, PDF export of selected categories, Israel-time "updated" clock.
- **Judge** (`index.html` → `js/app.js`): claim a climber/route with heartbeat locking (`claims`),
  draft with undo history, zone/top/attempt buttons, confirm zero outcome, "confirm and next",
  judges hidden by `liveFlag`, `initialAttempts`.
- **Admin** (`admin.html` → `js/admin.js`): CSV/Excel registration import, category groups, routes per
  category, starting-order editing, per-climber audit log and appeals, Excel + PDF export, results
  backup/restore, next round generation with `advanceQuota` (default 24), ordering (shuffle/sort) and
  `previousPlace` carried over, test data.

### Data worth migrating (Observed shape only; no values copied)

At capture time the public read returned `config`, a `roster` of **48 climbers** (name, club,
category, gender, bib) and `routeCount`; `results`, `audit` and `appeals` were empty. So the app holds
**one round at a time**, with no historical results. Worth migrating: the roster (→ profiles +
registrations) and the category-group setup. History has to come from elsewhere (LogLig or exports).

### Security notes (Observed)

- An **anonymous** visitor's live page subscribes to the whole database root and received ~12 KB:
  roster, config and, during a competition, results, audit and appeals. Unknown whether anonymous
  *writes* are allowed (not tested; writing to a live system was out of scope).
- `js/adminConfig.js` ships a hardcoded admin username and password (5/13 chars, values not recorded
  here). It is only used when cloud sync is off (production uses Firebase Auth). Still, it's public:
  remove it, and rotate it if it was reused anywhere.

## 3. IFSC app `org.ifsc.boulder14` ("WC Series")

- Package (Observed): v2.16.6 (240192), minSdk 24, targetSdk 36, 3,456 classes; permissions INTERNET,
  READ_PHONE_STATE, storage, CHECK_LICENSE.
- Signature (Observed, apksig 9.4.1): base + 4 splits all verify (v2/v3; splits also v1). One signer,
  `CN=Tim Hatch, C=UK`, cert SHA-256 `2812d3a8…ab4cf82`, valid from 2013-02-20. No official
  fingerprint is published to compare against (Unknown authenticity beyond "consistent and valid").
- Built with React Native (Hermes bytecode `assets/index.android.bundle`, Reanimated, React Navigation,
  Redux Toolkit) (Observed). Data source `https://ifsc.results.info` `/api/v1/…` (seasons,
  season_leagues, events, cuwr) — the same API as the website (Observed strings).
- Feature inventory (Inferred from bundle strings; Hermes isn't decompiled by REA): calendar, events,
  live results, rankings, athletes, search, notifications, share, dark mode, discipline filters
  (boulder/lead/speed/para/youth). No favorites/following strings found.

## 4. LogLig app `com.loglig.climbing` ("Loglig - Israel Climbing")

- Package (Observed): v1.2.11 (100023), minSdk 24, targetSdk 36; push (FCM), badges, ad-ID permissions.
- Signature (Observed): verifies (v2/v3), certificate `CN=Android, OU=Android, O=Google Inc.…`,
  SHA-256 `539a36ab…2763454`, valid from 2020-03-30. Inferred: a Google Play App Signing key.
- Built with Cordova + Ionic 1 / AngularJS (`assets/www`) (Observed). Backend
  `https://loglig.com:8443/api/...` with OAuth `/token` (Observed). A generic multi-sport federation
  platform: leagues, teams, games, fans, friends, chat, notifications, referee results, clubs, union
  events, benefits, rankings (Observed routes/endpoints).
- Climbing-relevant (Observed): competition rank tables per type/gender (`ClubName`, `FinalScore`,
  `Rank`), `/api/Account/ClimbingAchivementInfo/{userId}/{seasonId}` (per-climber achievements by
  season), `/api/Union/Competitions`, `/CompetitionAges`, `/UnionRankings`, events, clubs.
- History import (Inferred): possible through `ClimbingAchivementInfo` and the competition rank
  tables, but they need a LogLig account token, so it needs LogLig/ILCA's cooperation or an export
  from them. Field-level schema and terms of use: Unknown.

## Parity gaps and what was done

| Gap | Source | Action |
|---|---|---|
| Placeholder colors/typography | IFSC | **Done:** IFSC tokens in `src/styles.css`, Heebo (Roboto + Hebrew), white header with underline tabs, IFSC boulder tiles |
| Results table layout | IFSC | **Done:** rank / name + meta + tiles / score; no horizontal scroll at 390px |
| Tie-breaks (countback, top attempts, zone attempts) | Temp app, IFSC | **Done:** `scoring.ts` + migration `20261015000001_scoring_tiebreaks.sql` (`round_scores.prev_rank`), tests both sides |
| Points never below 0 | Temp app | **Done** (both sides) |
| Category groups (rank several categories together) | Temp app | Open: schema change |
| Advancement quota + next-round start list | Temp app, IFSC | Open: today every registrant appears in every round |
| Judge claim/lock per climber, undo history | Temp app | Partly: we have undo; locking open |
| Appeals | Temp app, IFSC (`under_appeal`) | Open |
| Favorites, PDF/Excel export, CSV registration import | Temp app | Open (CSV import belongs in the admin UI) |
| Push notifications | LogLig, IFSC | Open |

Countback note: we follow the temporary app (always apply countback) rather than IFSC's apparent
"only at cutoffs" rule. One difference: the temporary app skips countback when either climber
lacks a previous place, while we sort a missing previous rank last, because SQL `rank()` needs a total
order. Revisit if ILCA's rules say otherwise.
