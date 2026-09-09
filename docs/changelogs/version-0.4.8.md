# KBB Bot v0.4.8 — Top-5 Button & Reset Fix

## Fixed

- The weekly **Spieler abgeben** button now uses the same Kickbase market-value lookup service as `/kbb top5`.
- Surname-only entries such as `Kane` are sent through Kickbase player resolution instead of being stored as raw text.
- Successfully resolved submissions store the official Kickbase player name, player ID, current market value, league/competition metadata and lookup timestamp.
- Public button submissions now include the saved market value.
- The private confirmation also shows the resolved player name and market value.
- Ambiguous or unknown names are rejected with suggestions instead of silently saving the wrong player.

## Reset UX

- `/kbb top5-reset` now immediately posts a visible new-round marker.
- The stale previous-round button is cleaned up immediately.
- A fresh submission button for the new round is created right away instead of waiting for the scheduler.
- The visible round marker also prevents pre-reset submissions from being recovered into the new round after a deploy.
