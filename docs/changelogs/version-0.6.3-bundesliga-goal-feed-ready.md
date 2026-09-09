# KBB Bot v0.6.3 — Bundesliga live goal feed ready

- Prepared the Bundesliga live-goal feed for the first live weekend starting Friday.
- ESPN Bundesliga scoreboard requests are now always date-scoped using the current `Europe/Berlin` date. This avoids the stale-season/event-ID problem discovered during the Champions League test.
- No fixed external game IDs are used for Bundesliga matches. All live Bundesliga fixtures for the current date are discovered directly from ESPN.
- Goal parsing uses multiple ESPN scoring-event sources (`keyEvents`, competition details and summary details) for better resilience.
- For every detected goal, the scorer is matched against Kickbase `/v4/leagues/{leagueId}/live` ownership data.
- Assists are matched through the same Kickbase ownership path when ESPN provides an assist.
- Kickbase manager names are mapped to the 14 stored Discord managers through their current server nickname / Discord names; unambiguous matches produce real Discord mentions.
- If ownership or Discord mapping cannot be resolved safely, no incorrect Discord user is tagged.
- Goal events are persisted through durable `KBBGOAL:` markers in Discord embed footers to prevent duplicates after restarts or deploys.
- After a restart, completed matches are only revisited when that match already has feed markers in the channel. This allows recovery of missed late goals without backfilling entire old matchdays.
- Polling remains configurable and defaults to every 30 seconds.
- `KBB_GOAL_CHANNEL_ID` now controls the output channel. For the first real Bundesliga weekend it defaults to the experimental channel `1522249317656690929`.
- The temporary Liverpool vs Atletico Champions League scheduler is no longer started by the bot.
- `/kbb help` and Kickbase diagnostics were updated for the Bundesliga live feed.
