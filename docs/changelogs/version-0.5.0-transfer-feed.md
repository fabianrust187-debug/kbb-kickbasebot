# KBB Bot v0.5.0 — Kickbase Transfer Feed Test

## New

- Added a read-only Kickbase league activity-feed reader using `GET /v4/leagues/{leagueId}/activitiesFeed`.
- Transfer activity type `15` is parsed into buyer, seller, player, transfer price and timestamp.
- Manager-to-manager purchases are rendered as `Buyer bought Player from Seller for Price`.
- Purchases without a manager seller are shown as purchases from the KICKBASE market.
- Player names are enriched through player-detail endpoints when available.
- Added admin-only `/kbb feed-test`.
- Optional `/kbb feed-test anzahl:<1-15>` controls how many recent purchases are shown; default is 10.
- Test output is hard-restricted to Discord channel `1522249317656690929` (or `KBB_TEST_CHANNEL_ID` when configured).
- The first version is intentionally manual-only; no automatic polling or public production-channel posting is enabled yet.

## Safety / Scope

- Kickbase integration remains read-only.
- No bids, purchases, sales or market actions are performed.
- Feed-test output does not ping Discord members.
- The test command requires Manage Server or Administrator permission.
