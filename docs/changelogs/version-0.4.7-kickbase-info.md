# KBB Bot v0.4.7 — Kickbase Diagnostics

## New

- Added `/kbb kickbase-info` for administrators.
- The command tests the configured Kickbase credentials without exposing secrets.
- It loads the leagues available to the configured Kickbase account.
- It resolves `KICKBASE_LEAGUE_NAME` or `KICKBASE_LEAGUE_ID` and shows the matching league ID.
- It shows the configured competition ID and authentication method.
- If the configured league cannot be matched exactly, the command lists available league names and IDs privately so the correct value can be selected.
- `/kbb help` now includes the new diagnostics command.

## Security

- The command never displays the Kickbase email, password, or authentication token.
- Output is ephemeral and restricted to users with Manage Server or Administrator permission.
