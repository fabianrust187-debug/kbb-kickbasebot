# Version 0.6.13 — Ownership surname dedupe

- Fixed Kickbase owner matching when the same player appears multiple times from squad/live sources.
- Full ESPN names can now resolve safely against Kickbase surname-only records when all matching records belong to the same manager.
- This fixes cases such as `Jeremiaha Maluze` resolving to manager `JANNES` even if Kickbase exposes the player as `Maluze` in one source.
- No fallback assigns an owner when matching records belong to different managers.
- Bundesliga Livefeed V4 and `/kbb owner-test` automatically use the improved resolver.
