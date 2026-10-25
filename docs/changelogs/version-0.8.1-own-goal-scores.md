# Version 0.8.1 — Correct Bundesliga own-goal scores

- Fixed Bundesliga Liveticker own-goal attribution. ESPN event `team.id` denotes the team **credited** with the goal; for an own goal this is the team benefiting from it, not the player's club. The former implementation inverted this id a second time.
- Goal scores now advance by the credited team, and any inconsistent embedded ESPN `homeScore/awayScore` is ignored rather than carried into subsequent goal posts. Inconsistencies are logged for troubleshooting.
- For an own goal, the main headline explicitly says `Eigentor durch <Spieler>` instead of displaying it as an ordinary goal. Own goals do not display an assist.
- If no credited team can be resolved, the ticker only trusts an explicit coherent one-goal score update. Otherwise it avoids inventing a score.
- Added Node tests for own goals, normal goals, subsequent scores and unknown-team fallbacks. Run with `npm test`.
- Discord manager mentions, transfer ticker and other live actions are unchanged.
- Previously posted messages are not retroactively edited.

Example: SC Freiburg 0:2 Bayern; Tom Bischof scores an own goal benefiting Freiburg => **SC Freiburg 1:2 Bayern**; a later Bayern goal => **1:3**, not 0:4.
