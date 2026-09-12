# Version 0.6.12 — Bundesliga Livefeed V4

- Switched the productive Bundesliga live scheduler from V3 to V4.
- Ownership resolution now uses the reliable Kickbase snapshot resolver directly, so duplicate squad/live records from the same manager no longer make a player look unowned.
- Goal enrichment now merges ESPN `scoringPlays`, `keyEvents`, match details and commentary.
- Assist information found only in later commentary is attached to the already known goal before posting.
- Existing goal settle delay remains, allowing score and assist data to arrive before the single Discord message is sent.
- Red/yellow-red cards, injury substitutions, restart baselining and manager Discord mentions remain enabled.
