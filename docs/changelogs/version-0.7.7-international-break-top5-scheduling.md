# Version 0.7.7 — Bundesliga-aware Top-5 scheduling

- Automatic Friday Top-5 starts now check whether a Bundesliga matchday is actually scheduled for that Friday/Saturday/Sunday.
- Weekends without Bundesliga fixtures, including international breaks, are skipped automatically.
- The current international break therefore skips 25 September and 2 October 2026.
- The next regular automatic Top-5 round is expected to open on Friday, 9 October 2026 at 20:00 Europe/Berlin, ahead of Bundesliga Matchday 5.
- Manual `/kbb top5-start` remains available for special cases such as an English week and bypasses the automatic schedule gate.
- `/kbb help` now documents matchday-aware scheduling.
