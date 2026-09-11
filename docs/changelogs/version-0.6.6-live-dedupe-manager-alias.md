# KBB Bot v0.6.6 — Live event dedupe + manager alias fix

- Fixed duplicate Bundesliga live events caused by ESPN exposing the same event in multiple data blocks.
- Goal events are now semantically deduplicated before score reconstruction, preventing one real goal from becoming 0:1, 0:2 and 0:3.
- Red/yellow-red cards are deduplicated per player before posting.
- Injury substitutions are deduplicated per player and prefer the event variant with a valid match minute.
- Existing Discord marker recovery remains active so restarts do not intentionally replay already posted raw events.
- Added a central manager alias mapping for `Forever#20` -> Discord user `1527344409451040879`.
- The alias is used by both the transfer feed and Bundesliga live feed.
