# Version 0.7.9 — Owner-test interaction timeout

- `/kbb owner-test` acknowledges the Discord interaction immediately in the central router, before slow Kickbase requests start.
- Direct invocations of the diagnostic do not defer a second time.
- Ownership diagnostics now prefer the already verified/cached roster rather than forcing a new full 14-manager scan for each command invocation.
- A 45-second diagnostic time limit returns a meaningful private Kickbase API/roster timeout message, instead of leaving the command loading indefinitely. In-progress snapshots can still finish and be reused after the diagnostic times out.
- Added server logs for request start, completed owner result, roster counts and failures.
- No change to Livefeed posts, manager role settings or automatic transfer notifications.
