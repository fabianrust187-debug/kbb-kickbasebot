# KBB Bot v0.6.5 — Cards & injuries in Bundesliga live feed

- Bundesliga live feed now detects direct red cards and second-yellow/red cards.
- Official Kickbase card deductions are shown in the Discord alert: red card `-75`, yellow-red `-50`.
- Kickbase `/leagues/{leagueId}/live` parsing now exposes current live points and card counters when available.
- Card alerts resolve the affected player to the current Kickbase owner and Discord manager mention.
- Explicit injury substitutions can now produce an injury alert with the affected player's manager mention.
- Injury alerts are conservative: ordinary tactical substitutions are ignored and no injury severity is guessed.
- Goals, cards and injury alerts share durable Discord deduplication markers and recovery handling.
- Production output remains in `#kickbase-chat` (`1522249187666952254`).
