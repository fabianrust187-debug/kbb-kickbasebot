# KBB Kickbase Bot — Changelog

## Version 0.4.5 — Top-5 Button Cleanup

### Improved

- The Top-5 channel now keeps **exactly one** submission-button message for the active round.
- Duplicate button messages created by rapid deploys, restarts or tests are automatically deleted.
- Button messages from older Top-5 rounds are deleted instead of only being disabled.
- After a round change, the scheduler removes stale buttons and keeps/posts only the current round's button.
- The cleanup runs automatically with the existing Top-5 scheduler, so no manual cleanup command is required.
- `/kbb top5` remains available as a fallback submission method.

## Version 0.4.4 — Weekly Top-5 Submission Button

### New

- The Top-5 channel now gets a persistent **🎯 Spieler abgeben** button for the active round.
- Pressing the button opens the same private player-name form as `/kbb top5`.
- The button is created automatically after bot startup and after every newly started Top-5 round.
- Old buttons from previous rounds are automatically disabled.

### Per-Manager Validation

- A manager who has not submitted yet can use the button and enter a player immediately.
- A manager who already submitted in the current round receives a private confirmation showing the player already submitted.
- Buttons from older rounds are rejected with a private stale-round notice.
- Once Tuesday 22:00 has been reached, the active round no longer accepts new submissions through the button.
- The public Discord button remains visually visible to everyone because Discord cannot disable one shared button for only one individual user; eligibility is therefore checked privately on every click.

## Version 0.4.3 — Tuesday Top-5 Deadline

### Changed

- The Top-5 deadline moved from **Monday 22:00** to **Tuesday 22:00 Europe/Berlin**.
- The automatic scheduler now publishes the deadline report every Tuesday from 22:00 onward, once per active round.
- `/kbb rules`, `/kbb league`, `/kbb top5-status` and `/kbb help` now show the Tuesday deadline.
- A round created on Tuesday at or after 22:00 automatically receives the following Tuesday as its next deadline.

### Current Round

- Existing submission timestamps are re-evaluated against the new Tuesday deadline.
- Submissions made before Tuesday 22:00 are therefore considered **on time** and are not reported as late.

## Version 0.4.2 — Incomplete Roster Deadline Handling

### Fixed

- `/kbb top5-missing` no longer fails when the manager roster is incomplete, for example **13/14**.
- The bot now still publishes all known managers who did not submit on time.
- Known late submissions continue to be shown with their exact submission time.
- Missing roster slots are shown as a warning instead of blocking the entire deadline report.
- Automatic Monday 22:00 deadline checks also continue to work with an incomplete roster.

### Improved Manager Handling

- If the manager roster is not yet full, a legitimate participant using `/kbb top5` is automatically added to the roster.
- Only when the roster is already full at 14/14 and an unknown user tries to submit is the submission blocked.
- `/kbb top5-status` now warns when roster entries are missing without claiming that the deadline system is disabled.
- `/kbb manager-list` now explains that deadline checks remain active even with an incomplete list.

## Version 0.4.1 — Top-5 Recovery & Deploy Safety

### Fixed

- Top-5 submissions are no longer silently lost after a clean deploy/rebuild.
- On bot startup, the bot scans the configured Top-5 Discord channel and reconstructs the active round from its own public submission messages.
- Original Discord message timestamps are restored as submission timestamps, so late submissions can still be detected correctly after a deploy.
- Historical submission messages are also used to recover known league managers.

### Manager Roster Persistence

- Once the manager roster reaches **14/14**, the bot automatically posts a Discord system snapshot of the complete manager list.
- The snapshot is not used to ping managers; it exists as a persistent recovery source inside Discord.
- After future deploys, the bot can restore all 14 managers from the latest system snapshot instead of relying only on local JSON files.
- A new snapshot is created automatically whenever the complete 14-manager roster changes.

### Round Recovery

- Automatic/manual round closures now post a visible **Neue Top-5-Runde gestartet** marker.
- Recovery only rebuilds submissions after the most recent round boundary, preventing old submissions from leaking into a new round.
- Fixed the next deadline calculation for rounds started on Monday at or after 22:00; those rounds now correctly use the following Monday.

## Version 0.4.0 — Automatic Top-5 Deadline Check

### New Features

- Added an automatic Top-5 deadline check every **Monday at 22:00 Europe/Berlin**.
- The bot posts the managers who did not submit in time directly in the configured Top-5 channel.
- Late submissions are detected by their saved submission timestamp. A player submitted after 22:00 is shown as **zu spät** with the submission time.
- After the automatic Monday deadline post, the current Top-5 round is archived and a fresh round is started automatically.
- Added `/kbb top5-missing` for admins to publish the deadline result manually at any time.
- `/kbb top5-missing runde_abschliessen:true` can also close the current round and immediately start the next one.
- Added a persistent KBB manager roster so deadline checks know exactly which 14 managers are expected.
- Added `/kbb manager-add`, `/kbb manager-remove` and `/kbb manager-list`.
- The automatic deadline check only runs successfully when the manager roster contains exactly **14 managers**.
- `/kbb setup` can now also configure the Top-5 channel.
- `/kbb help`, `/kbb league`, `/kbb rules` and `/kbb top5-status` were extended with the deadline/manager information.

### Deadline Rules

- Deadline: **Monday, 22:00 Uhr**.
- Missing submission: manager has no submission for the active round by the deadline.
- Late submission: submission timestamp is after the round's Monday 22:00 deadline.
- Automatic deadline output is deduplicated so it is posted only once per round/deadline.

## Version 0.3.2 — Public Nickname Change Notice

### Changed

- After a successful `/kbb name` submission, the bot now posts a public message in the same channel.
- The message shows the manager mention, the previous server name and the new Kickbase name.
- The private confirmation remains visible only to the manager who submitted the form.
- Nicknames are escaped before posting so formatting characters cannot break the announcement.
- Mentions are restricted to the renamed manager to prevent unwanted mass mentions.

## Version 0.3.1 — Kickbase Name Modal

### Changed

- `/kbb name` no longer requires a `nickname:` parameter.
- Running `/kbb name` now opens a private Discord input window.
- Managers enter their Kickbase account name in the modal and confirm it there.
- The bot changes only the nickname on the **187 KICKBASEBANDE Discord server**.
- The global Discord username, display name and names on other servers remain unchanged.
- `/kbb help` was updated to explain the new workflow.

### Permissions

- The bot needs **Manage Nicknames / Nicknames verwalten**.
- The bot role must be above the member role it should rename.
- Discord does not allow the bot to rename the server owner or members above its role.

## Version 0.3.0 — Kickbase Nickname Sync

### New Features

- Added `/kbb name nickname:<Kickbase-Name>`.
- Managers can now set their own Discord server nickname to their Kickbase account name.
- The command normalizes extra spaces and validates Discord's nickname length limit.
- The bot checks whether it has the required **Manage Nicknames** permission before changing a nickname.
- If Discord blocks the rename because of role hierarchy or server ownership, the bot returns a clear private error message.

### Notes

- The bot role must be above normal member roles in the Discord role hierarchy.
- The bot needs the Discord permission **Manage Nicknames / Nicknames verwalten**.
- The confirmation and error messages are ephemeral, so the channel stays clean.

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
