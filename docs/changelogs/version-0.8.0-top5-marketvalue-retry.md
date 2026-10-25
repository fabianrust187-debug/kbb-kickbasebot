# KBB v0.8.0 — Recover missing Top-5 market values

- New `/kbb top5-mw-retry`: any registered manager can recover their own missing Top-5 market value; admins may optionally select `manager:` to repair another manager's submission.
- The command does not change the originally submitted player or timestamp and does not allow a second Top-5 submission.
- When Kickbase returns a verified numeric price, the existing Top-5 message is edited for durable Discord recovery. If editing fails, a fallback message preserves the original submission timestamp.
- The public message marks recovered prices as *nachträglich ermittelt*: these are live values at retry time, **not guaranteed historical prices at submission**.
- API errors and ambiguous/not-found players do not erase stored submissions or replace an existing numeric market value.
- Kickbase player detail lookups also check nested player wrappers for a market value.
- Submission confirmations explain how to retry when a market value is unavailable; `/kbb help` lists the command.
- The fix does not retroactively change saved values by itself; execute the retry command once after deployment.
