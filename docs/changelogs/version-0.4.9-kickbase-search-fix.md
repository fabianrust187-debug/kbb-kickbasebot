# KBB Bot v0.4.9 — Kickbase Player Search Fix

## Fixed

- The Kickbase v4 player search now sends the required `leagueId` query parameter.
- Search result player IDs are now parsed from Kickbase's `pi` field as well as detail-response ID fields.
- Short player searches such as `Kane` can now resolve to the Kickbase player record instead of incorrectly returning `not found`.
- After resolving the search result, the bot loads the competition/player details so the stored name can become the full official player name (for example `Harry Kane`) and the current market value can be stored.
- The same corrected lookup is used by the Top-5 button and `/kbb top5` workflow.

## API Note

The current unofficial Kickbase v4 collection documents the search request as:

`GET /v4/competitions/{competitionId}/players/search?leagueId={leagueId}&query=Kane`

The example search response uses `pi` for the player ID and `mv` for the current market value.
