# Version 0.7.2 — Liveticker Role & Channel Fix

- The notification control is now fixed to the production liveticker channel `1549519679968510022`.
- The new self-service notification role is `1549523629811826708`.
- Stale hosting variables can no longer move the control message into an old feed channel or point it at the obsolete role.
- Old notification-control messages in the former Kickbase/transfer feed channels are cleaned up on startup.
- Current league managers are seeded with the new notification role once, provided the bot can manage the role.
- The role toggle continues to suppress active pings while keeping feed messages visible.
