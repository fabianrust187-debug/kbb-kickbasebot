# Version 0.6.8 — Live Feed Restart & Owner Fix

- Bundesliga live feed moved to V3.
- A bot restart/redeploy now baselines all already existing events of a currently running match, so old goals/cards/injuries are not reposted.
- New goals are held briefly and re-read on the next poll so ESPN can enrich the event with the correct score and assist before Discord receives one final post.
- Kickbase ownership now uses `/leagues/{leagueId}/ranking` for manager IDs and `/leagues/{leagueId}/users/{userId}/teamcenter` for complete manager squads.
- Live data is merged into the full squad snapshot to keep current live points where available.
- Torschützen, Vorlagengeber, Karten- und Verletzungsspieler can therefore be resolved even when the player is not in the manager's active Kickbase fantasy lineup.
- Existing manager aliases, including Forever#20 -> Discord user `1527344409451040879`, remain active.
- `/kbb help` and `.env.example` were updated for the new behavior.
