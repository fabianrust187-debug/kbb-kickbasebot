# Version 0.6.7 — Goal Merge & Owner Resolution

- Bundesliga live events now use stable semantic IDs instead of relying on one ESPN object ID.
- Multiple ESPN variants of the same goal are merged by match, minute and scorer before posting.
- The richest event variant wins and missing assist/score/team data is merged from duplicate variants.
- A previously posted event cannot reappear simply because ESPN later enriches it with an assist or another object ID.
- On restart during an already active match, existing channel events are baselined to avoid replaying the current match history.
- Kickbase ownership now falls back to full manager squads instead of relying only on `/live` lineup data.
- Torschütze and assist owner tags therefore work even when the player is not present in the live lineup payload.
- Existing manager aliases, including `Forever#20 -> 1527344409451040879`, remain active across transfer and Bundesliga feeds.
