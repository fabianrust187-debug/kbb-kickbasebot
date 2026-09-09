# KBB Bot v0.5.3 — Discord mentions in transfer feed

## Changed

- `/kbb feed-test` now tries to resolve Kickbase manager names to the 14 stored Discord managers.
- Matching uses the current Discord server display name/nickname plus stored usernames.
- Buyer and seller are rendered with a clickable Discord mention when a unique match is found.
- Manager-to-manager transfers can now look like: `Vegetarox (@Vegetarox) bought Player from Raps (@Raps) for Price`.
- Purchases from the normal KICKBASE market remain without a seller mention.
- Ambiguous or unmatched manager names are never guessed; the Kickbase name is shown without a Discord mention instead.
- The feature remains restricted to the internal test channel `1522249317656690929`.
