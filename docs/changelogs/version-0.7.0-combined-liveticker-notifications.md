# Version 0.7.0 — Gemeinsamer Liveticker & Benachrichtigungen

- Bundesliga-Liveereignisse und automatische Kickbase-Transfers laufen jetzt gemeinsam in Channel `1549519679968510022`.
- Der alte Transfermarkt-/Kickbase-Chat-Ausgabepfad wird für automatische Feeds nicht mehr verwendet.
- Neue Selbstbedienungs-Schaltfläche `Benachrichtigungen an / aus` im Liveticker.
- Die Schaltfläche verwaltet Rolle `1549520307646107699`.
- Aktuelle Liga-Manager werden bei der ersten Migration standardmäßig mit der Rolle versorgt, damit bestehende Benachrichtigungen nicht plötzlich verschwinden.
- Mitglieder ohne Benachrichtigungsrolle bleiben in den Feed-Meldungen als Manager erkennbar, werden aber nicht aktiv gepingt.
- Die Benachrichtigungspräferenz gilt für Bundesliga-Tore, Vorlagen, Karten, Verletzungen und Transfermeldungen.
- Beim Wechsel in den neuen Liveticker werden vorhandene Transfers als Ausgangsstand übernommen; standardmäßig werden keine alten Käufe erneut gepostet.
- `/kbb help` und `.env.example` wurden auf den gemeinsamen Liveticker und die neue Rollensteuerung aktualisiert.
