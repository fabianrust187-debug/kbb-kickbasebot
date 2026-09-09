# KBB Bot v0.5.1 — Top-5 Wochenablauf

## Geändert

- Reguläre Top-5-Runden starten automatisch erst am Freitag um 20:00 Uhr (Europe/Berlin).
- Der Abgabe-Button wird beim regulären Rundenstart erstellt, nicht mehr bei jedem Bot-Start oder Deploy.
- Die Deadline bleibt Dienstag um 22:00 Uhr (Europe/Berlin).
- Nach der Dienstags-Auswertung wird die Runde geschlossen und der Abgabe-Button entfernt.
- Zwischen Dienstag 22:00 Uhr und Freitag 20:00 Uhr wird keine neue reguläre Runde automatisch gestartet.
- Ein Deploy/Restart außerhalb einer laufenden regulären Runde erzeugt keinen neuen Button.

## Englische Wochen

- Neuer Admin-Befehl `/kbb top5-start`.
- Damit kann die Ligaleitung eine zusätzliche Top-5-Runde jederzeit manuell starten.
- Der Befehl erstellt den Rundenmarker und den Abgabe-Button sofort.

## Deploy-Stabilität

- Ein bereits vorhandener Button der aktuellen Runde bleibt nach einem Deploy nutzbar, selbst wenn die lokale Runden-ID neu rekonstruiert wurde.
- Alte Buttons werden weiterhin anhand des sichtbaren Discord-Rundenstarts erkannt und abgewiesen bzw. entfernt.

## Help

- `/kbb help` dokumentiert jetzt Freitag 20:00 Uhr als regulären Rundenstart, Dienstag 22:00 Uhr als Deadline und `/kbb top5-start` für Sonderrunden.
