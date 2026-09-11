# Version 0.6.9 — Assist Owner Resolution Fix

- Kickbase ownership now uses `/v4/leagues/{leagueId}/managers/{managerId}/squad` as the primary full-squad source, with Teamcenter/player endpoints kept as fallbacks.
- ESPN commentary suffixes such as `with a headed pass`, `with a cross` or similar are stripped before player matching.
- Assist names are displayed cleanly in Discord and can now be matched against Kickbase ownership correctly.
- Free players remain intentionally untagged.
- Additional live-feed logs include the resolved assist owner when available.
