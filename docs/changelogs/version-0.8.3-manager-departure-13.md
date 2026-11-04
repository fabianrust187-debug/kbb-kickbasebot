# KBB Bot v0.8.3 — 13 active managers after Raps leaves the league

- Reduced the active 187 KICKBASEBANDE Top-5 manager target from **14 to 13** across the regular deadline, status, late-submission flow, Friday start, closing logic, manager list, rules, help and Discord recovery.
- During startup recovery, the bot checks registered managers against Discord membership. A confirmed departed Discord member or the explicitly retired league manager `Raps` is removed from the active manager roster. Temporary Discord API errors do not cause automatic removal.
- An old persisted **14-manager** Discord roster is never blindly truncated to 13. All entries are checked and the correct 13 active managers restored; a new 13/13 snapshot is then saved in the Top-5 channel for subsequent Discloud deployments.
- Previous submissions remain preserved for audits/history. Active round counts, missing-player checks and finalization ignore entries from managers who have left.
- Prevented finalization if the active roster is still incomplete/inconsistent, even if old submissions happen to meet the numeric threshold.
- Admin `/kbb manager-remove` now supports `user:`, `name:` or `id:`, including users who already left Discord. A 13-manager roster snapshot is posted immediately when this command successfully restores the required count.
- The 13-manager setting is authoritative even if old Discloud installs still contain `TOP5_MANAGER_TARGET=14`; users should update that environment variable to 13 for clarity.
- Historical league fees and payout agreements are intentionally **not** changed automatically.
- Added tests for the active roster setting and name alias. Checked that an old 14-member roster can restore all 13 remaining members, and that retired submissions do not count towards 13/13 finalization.
