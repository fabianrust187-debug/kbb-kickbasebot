---
description: "Kickbase-Lesezugriff und Marktwertauflösung sicher debuggen"
---
# Kickbase API & Fehleranalyse

Diese Prompt-Vorlage auf einen konkreten Arbeitsauftrag im **bestehenden Repository** anwenden. Gegebene Fakten und Hypothesen unterscheiden.

1. Fehler: [HTTP-Code, Marktwert, Login, Spielername]. Tatsächlich implementierte API-Aufrufe in `src/utils/` und Konfiguration prüfen.
2. Bestehende Anbindung ist read-only. Keine Transfer-, Kauf- oder Verkaufsaktionen hinzufügen.
3. Keine Tokens, E-Mail oder Passwörter auslesen, in Debug-Ausgaben schreiben oder committen. Authentifizierung, Token-Ablauf, Fehlercodes und Rate Limits prüfen.
4. Mehrdeutige Namen als Auswahl behandeln; unbekannte Marktwerte nicht mit erfundenen Zahlen ersetzen. Zeitstempel für Snapshots erhalten.
5. Graceful Degradation sicherstellen: Top-5-Abgabe nicht wegen API-Ausfall verlieren.
6. Ursache und Patch nachweisen; Syntax-Checks und sichere Tests, ohne reale Liga-Daten zu verändern.

Quelle/Adaption: [prompts.chat](https://github.com/f/prompts.chat), offene Prompt-Daten CC0 1.0. Projektbezogen neu formuliert.
