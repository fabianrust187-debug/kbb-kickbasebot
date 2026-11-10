# KBB Bot v0.8.4 — Top-5-Freistellung pro Spieltag

- **Neu:** Admin-Befehl `/kbb top5-befreien manager:@Nutzer grund:Freitag im Minus` zur Freistellung einzelner Manager.
- Der Manager bleibt in der Liga, muss in der aktuellen Top-5-Runde jedoch keinen Spieler abgeben.
- Der Bot zählt **12 Abgaben + 1 Freistellung = 13/13 erledigt** und schließt die Runde automatisch, sobald alle übrigen Abgaben eingegangen sind.
- Freigestellte Manager erscheinen nicht mehr als fehlende Abgabe oder im Säumnisbericht.
- `/kbb top5-status` zeigt Spielerabgaben und Freistellungen getrennt.
- Öffentliche Freistellungsnachrichten werden nach Hosting-Neustarts für die aktive Runde wiederhergestellt.
- Freistellungen werden bei der nächsten Runde zurückgesetzt, im Rundenarchiv aber erhalten.
- Mehrfache Freistellungen, Freistellungen für Nicht-Manager und für bereits abgegebene Spieler werden abgelehnt.
