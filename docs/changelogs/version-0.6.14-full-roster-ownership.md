# Version 0.6.14 — Full Roster Ownership Fix

- Fixed Kickbase ownership snapshots only loading the first successful 11-player lineup source per manager.
- The resolver now queries and merges all available manager/user roster endpoints instead of returning after the first result.
- Added `/users/{managerId}/squad` as an additional ownership source.
- Nested Teamcenter/squad payloads are traversed completely so bench and reserve players are not skipped.
- `/kbb owner-test` should now report more than the previous 154 players when full rosters are available.
- Live-feed owner tagging benefits automatically for goals, assists, cards and injuries.
