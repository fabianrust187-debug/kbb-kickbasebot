# KBB Bot v0.6.4 — Bundesliga goal feed live

- Bundesliga live-goal output moved from the experimental channel to the public `#kickbase-chat` channel `1522249187666952254`.
- The default `KBB_GOAL_CHANNEL_ID` now points to the public channel while remaining overridable through hosting environment variables.
- Goal embeds no longer show the test marker when using the production channel.
- Scorer and assist are matched against current Kickbase live ownership and then against the stored Discord manager roster.
- Matching managers are mentioned directly in Discord; ambiguous or missing mappings are never guessed.
- The feed checks the current Bundesliga scoreboard around every 30 seconds, uses Europe/Berlin for the match date and keeps durable Discord goal markers for duplicate protection/recovery.
- `/kbb help` now shows the Bundesliga goal feed as live production output in `#kickbase-chat`.
- The previous Champions League parser test remains disabled from normal bot startup.
