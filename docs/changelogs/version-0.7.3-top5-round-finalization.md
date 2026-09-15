# Version 0.7.3 — Top-5 Round Finalization

- Top-5 rounds now close automatically as soon as all 14 manager submissions are recorded.
- The final status message confirms 14/14 submissions and removes the submission button.
- Late submissions remain marked as late; already imposed penalties are explicitly not cancelled by a later submission.
- Discord recovery now treats only a real "Neue Top-5-Runde gestartet" message as a round boundary. The Tuesday deadline message no longer splits the same round, so late/corrective submissions survive deploys.
- Recovery can finalize an already complete round after a rebuild without reposting the same completion message.
- Duplicate Tuesday deadline messages after a deploy are prevented by checking the existing Discord history.
- `/kbb help` now documents automatic 14/14 round finalization.
