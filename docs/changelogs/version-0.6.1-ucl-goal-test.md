# KBB Bot v0.6.1 — Liverpool vs Atletico UCL goal test

- Added a temporary Champions League live-goal watcher for Liverpool FC vs Atletico Madrid on 2026-09-09.
- ESPN competition: `uefa.champions`.
- ESPN event ID: `74165884`.
- Output remains restricted to the experimental channel `1522249317656690929`.
- The target match is checked roughly every 30 seconds while live.
- New goals are deduplicated with durable Discord embed markers so restarts do not repost the same goal.
- Goal output includes score, scorer, assist when ESPN provides one, match teams and minute.
- If the bot is deployed after kickoff, at most one already-existing goal is backfilled by default so the feed can still be tested.
- This temporary Champions League test does not replace or disable the existing Bundesliga goal-feed test.
- Kickbase manager ownership cannot be validated for Liverpool/Atletico players because the configured Kickbase league is a Bundesliga competition; this test is intended to validate live event detection, score/scorer/assist parsing and Discord delivery.
