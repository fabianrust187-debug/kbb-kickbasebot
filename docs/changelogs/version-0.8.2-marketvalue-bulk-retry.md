# KBB Bot v0.8.2 — Top-5-Marktwerte stabilisiert

## Ursache und Stabilisierung
- Die Kickbase-V4-Marktwert-Abfrage konnte nach vorübergehenden HTTP 429/5xx- oder Verbindungsfehlern ohne neuen Versuch fehlschlagen. Das ist eine mögliche Erklärung für mehrere direkt aufeinanderfolgende fehlende Werte; zur Bestätigung des konkreten Vorfalls werden Discloud-Logs benötigt.
- Abfragen versuchen vorübergehende 429/500/502/503/504-Fehler mit kurzen, begrenzten Wartezeiten erneut. Fehlerhafte Anmeldungen und andere dauerhafte 4xx-Fehler werden nicht blind wiederholt.
- Gleichzeitige Login-Vorgänge in diesem API-Modul werden zusammengefasst.
- Unnötige zusätzliche Player-Detail-Abfragen wurden reduziert: Ligadetails vor Wettbewerbsdetails, die zweite Quelle nur bei fehlendem Wert.
- Ein gefundener Spieler ohne numerischen Marktwert wird nun ausdrücklich als `VALUE_MISSING` diagnostiziert, nicht als erfolgreiche Marktwertauflösung.

## Reparatur bereits eingereichter Abgaben
- `/kbb top5-mw-retry alle:true` (nur Administratoren) versucht alle fehlenden Marktwerte der laufenden Runde der Reihe nach nachzuladen.
- Die ursprüngliche Top-5-Abgabe, ihr Spielername, ihr Erfassungszeitpunkt und ihr Pünktlichkeitsstatus bleiben erhalten.
- Vorhandene Discord-Abgabemeldungen werden nach Möglichkeit bearbeitet. Kann eine Nachricht nicht bearbeitet werden, sichert eine Ergänzungsnachricht den ursprünglichen Zeitstempel für die Wiederherstellung nach Deploys.
- Bestehende numerische Marktwerte werden nicht überschrieben. Pro fehlendem Wert wird Erfolg oder Fehler einzeln protokolliert.
- Nachgeladene Werte werden als *nachträglich ermittelt* markiert: Sie sind der **aktuelle Wert zum Abrufzeitpunkt**, nicht automatisch der historische Wert der ursprünglichen Abgabe.
- `/kbb top5-mw-retry` für eigene Abgaben und `manager:` für einzelne Admin-Korrekturen bleiben bestehen.
- `/kbb help` ist aktualisiert.
- Neue Tests decken Rate-Limit-Wiederholungen und fehlende Werte ab.
