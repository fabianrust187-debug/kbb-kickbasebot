# Version 0.6.16 — Injury Dedupe

- Bundesliga live feed upgraded to V5.
- Injury-forced substitutions are deduplicated by match + player instead of player + minute.
- If ESPN returns the same injury once without a clock and again with the real minute, only the richer event survives.
- Injury notifications are held briefly (default 20 seconds) so the real minute can arrive before posting.
- Red/yellow-red cards are also deduplicated semantically by player + card type, independent of clock corrections.
- Goal, manager-tag, assist and Kickbase ownership logic remains active.
