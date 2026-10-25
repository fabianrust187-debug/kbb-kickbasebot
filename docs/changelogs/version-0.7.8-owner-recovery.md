# Version 0.7.8 — Liveticker ownership reliability

- The Bundesliga live feed no longer publishes live events with empty manager names when the Kickbase ownership snapshot fails or is incomplete. Events remain pending and are retried on the next poll; free players remain untagged if the snapshot is healthy.
- Previously the owner resolver requested up to five endpoints for every manager each minute (~70 requests for 14 managers). It now prioritizes the two relevant endpoints, probes other variants only on empty results, limits concurrency and caches healthy snapshots for at least five minutes.
- Kickbase authentication refresh and ownership snapshot rebuilds are deduplicated to prevent unnecessary parallel login and roster requests.
- The owner directory additionally checks the league managers/users endpoints and recognizes further response-array wrappers.
- Ownership health checks reject empty/partial roster snapshots instead of reporting them as successful.
- `/kbb owner-test` now reports how many managers have a recognized roster, plus squad and live-player counts, including on failure.
- Existing Discord notification-role, manager aliases, event deduplication and transfer feed remain unchanged.
- Already posted events are not retroactively edited.
