# KBB Bot v0.6.2 — UCL goal-test fix

- Fixed the temporary Liverpool vs Atletico goal-feed test.
- Removed the incorrect assumption that a game ID from another football data source is an ESPN event ID.
- ESPN match discovery now uses the configured date plus home/away team names and then resolves the real ESPN event ID at runtime.
- ESPN scoreboard requests are date-scoped so the current matchday is loaded instead of the default older competition season snapshot.
- Completed matches are now supported for parser verification and can backfill historical goals into the experimental channel.
- Goal extraction now checks multiple ESPN locations (`keyEvents`, summary competition details, summary details, scoreboard competition details) to be more resilient to response-shape differences.
- Live-test output remains restricted to Discord channel `1522249317656690929`.
- Bundesliga production/test logic is unchanged.
