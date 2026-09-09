# Version 0.5.4 — Live Kickbase Transfer Feed

## Production rollout

- The Kickbase transfer feed is now enabled for the production transfer-market channel `1522249401735839784`.
- The bot polls the Kickbase league activity feed automatically every 60 seconds.
- New purchase transfers are posted as individual messages/embeds in chronological order.
- Buyer and seller Discord mentions are resolved from the stored KBB manager roster and current server nicknames when the mapping is unambiguous.
- Purchases from the ordinary Kickbase market are shown as coming from `KICKBASE-Markt` without a seller mention.

## Duplicate protection

- Every posted transfer carries its Kickbase activity ID in an internal footer marker.
- On startup the bot scans recent messages in the production transfer channel and restores the already-posted transfer IDs.
- Restarting or redeploying the bot therefore does not normally repost the same transfers.
- The scheduler also guards against overlapping poll cycles.

## First activation

- If the production channel has no previous transfer-feed markers, the bot backfills up to the five newest purchases once so the live feed is immediately visible.
- Afterwards only newly detected transfers are posted.

## Test mode

- `/kbb feed-test` remains available for administrators and still posts only to the experimental feature channel `1522249317656690929`.
- The production feed remains read-only and never performs Kickbase purchases, sales or bids.
