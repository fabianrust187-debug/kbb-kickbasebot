# KBB Kickbase Bot — Changelog

## Version 0.2.0 — Top-5 Submission Workflow

### New Features

- Added `/kbb top5` for private Top-5 player submissions.
- The command is restricted to the Top-5 submission channel `1522249357179617331`.
- Users enter the player name through a private Discord modal, so the channel stays clean.
- After a successful submission, the bot posts one public line: `Manager: @user hat **Spielername** abgegeben.`
- Each manager can only submit one player per active Top-5 round.
- Added `/kbb top5-status` to show current submission progress.
- Added `/kbb top5-reset` for admins / server managers to start a new Top-5 round.
- When 14 managers have submitted, the bot posts an automatic summary.
- Added persistent Top-5 storage in `src/data/top5Submissions.json`.

### Notes

- Kickbase market values are prepared as a future field but are not automatically fetched yet.
- A Kickbase market-value integration needs either a reliable API, login/session handling, or another trusted player data source.

## Version 0.1.0 — Initial Bot Foundation

### New Features

- Created the first project structure for the **187 KICKBASEBANDE** Discord Bot.
- Added Discord.js v14 setup.
- Added slash-command registration.
- Added `/ping` command.
- Added `/kbb help` command.
- Added `/kbb rules` command with the first rulebook for Saison 26/27.
- Added `/kbb league` command with league overview.
- Added `/kbb setup` command for storing rules and announcement channels.
- Added local guild settings storage.
- Added embed helper utilities.
- Added `.env.example`, `.gitignore` and README.

### Current League Defaults

- League: 187 KICKBASEBANDE
- Season: 26/27
- Start: 28.07.
- Managers: 14
- Starting capital: Team + 50 Mio
- Entry fee: 20 €
- Communication: Discord server

### Next Planned Modules

- Penalty catalog.
- Manager list.
- Matchday management.
- Transfer / underpay checks.
- Announcement automation.
