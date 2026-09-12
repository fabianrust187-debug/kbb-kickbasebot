# Version 0.6.10 — Ownership Resolver & Diagnostic

- Kickbase manager discovery now uses league overview with `includeManagersAndBattles=true`, ranking and manager settings as combined sources.
- Squad parsing is more tolerant of different Kickbase response wrappers and nested player lists.
- Manager squad loading tries the full manager squad/player endpoints before user/teamcenter fallbacks.
- Added `/kbb owner-test spieler:<Name>` for admin-only ownership diagnostics without waiting for another live goal.
- The diagnostic reports manager count, squad-player count, live-player count and the resolved Kickbase owner.
- `/kbb help` now documents the ownership diagnostic and updated resolver.
- Bundesliga posts still leave genuinely unowned/free players without a manager tag.
