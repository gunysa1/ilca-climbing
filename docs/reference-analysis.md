# Reference analysis (REA)

Goal: align style with ifsc.results.info and check feature parity with the IFSC app
(org.ifsc.boulder14), the current LogLig app (com.loglig.climbing) and the temporary app
(ilca-boulder-score.netlify.app/live.html).

## Status (2026-10-14)

| Reference | Status | Notes |
|---|---|---|
| ifsc.results.info | **Pending** | Host blocked by the build environment's network policy (DNS not resolvable from REA's browser or WebFetch). |
| ilca-boulder-score.netlify.app | **Pending** | Same: blocked. Need its scoring model, data source and screens. |
| IFSC app (Play Store) | **Pending** | REA needs a local APK; Play Store download not available in the environment. |
| LogLig app (Play Store) | **Pending** | Same. Public App Store listing describes competition/club/athlete pages, registration, achievements. |

## Decisions taken without the references (revisit)

- Colors and typography in `src/styles.css` are placeholders (navy bar, green top / amber zone).
- Scoring defaults to IFSC 2025 points; `classic` is available per round.
- Judge flow: pick boulder → pick climber → +1 attempt / zone / top / undo, autosaved.

## Next steps once hosts are reachable

1. `capture_browser_scenario` on ifsc.results.info (desktop + 390px) → extract color/typography tokens and
   results-table layout; replace the placeholder tokens.
2. Capture the temporary app's live page and bundle (`analyze_web_bundle`) → confirm scoring model,
   data backend, and any data to migrate.
3. Supply APKs locally (e.g. pulled from a device with adb) → `inspect_android_package` for screen/feature inventory.
