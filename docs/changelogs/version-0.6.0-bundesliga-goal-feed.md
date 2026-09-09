# Version 0.6.0 — Experimental Bundesliga Live Goal Feed

## New

- Added an automatic Bundesliga live-goal watcher for the internal feature-test channel.
- Test output is hard-restricted to Discord channel `1522249317656690929` through `KBB_TEST_CHANNEL_ID`.
- ESPN Bundesliga (`ger.1`) scoreboard and match-summary feeds are polled during live matches.
- Scoring `keyEvents` are deduplicated using durable markers stored in the Discord embed footer.
- The bot attempts to read scorer and assist from structured event participants; text parsing is only a fallback.
- Current goal score and match minute are included in each live post.

## Kickbase / Discord Manager Mapping

- During live Bundesliga matches, the bot reads the configured Kickbase league `/live` endpoint.
- Live Kickbase players are mapped to the manager currently associated with them in the league data.
- The manager name is then matched to the 14 stored Discord managers and their current server nicknames.
- When the mapping is unambiguous, the scorer's manager is mentioned in Discord.
- When ESPN supplies an assist and Kickbase can resolve that player too, the assist player's manager is also mentioned.
- Ambiguous mappings are deliberately left untagged rather than mentioning the wrong Discord user.

## Example

`1:0 durch Harry Kane (@Manager)`

`Vorlage: Joshua Kimmich (@Manager)`

## Scheduler

- Default poll interval: 30 seconds.
- ESPN is checked first; Kickbase live data is only requested when at least one Bundesliga match is actually live.
- If the bot starts while a match is already in progress, at most the newest goal per match is backfilled by default.
- Existing Discord goal markers are recovered after restarts/deploys to prevent duplicate posts.

## Environment

Optional variables:

- `KBB_GOAL_FEED_INTERVAL_MS=30000`
- `KBB_GOAL_FEED_TIMEOUT_MS=10000`
- `KBB_GOAL_INITIAL_BACKFILL=1`

No new secret is required. Existing Kickbase credentials and `KBB_TEST_CHANNEL_ID` are reused.

## Test Phase

- No Bundesliga goal output is sent to a public league channel yet.
- The feature should remain in the experimental channel until scorer, assist, score progression and manager mapping have been validated during real Bundesliga matches.
