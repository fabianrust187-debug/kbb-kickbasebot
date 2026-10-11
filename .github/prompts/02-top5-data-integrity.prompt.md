---
description: "Top-5-Abgaben, Fristen und Datenwiederherstellung vor Regression schützen"
---
# Top-5 Workflow & Datenintegrität

Diese Prompt-Vorlage auf einen konkreten Arbeitsauftrag im **bestehenden Repository** anwenden. Gegebene Fakten und Hypothesen unterscheiden.

1. Task: [Abgabe, History, Missing, Reset, Recovery]. Betroffene Module, `README.md` und aktuelle Datenformate ansehen.
2. Abgaben und historische Marktwerte mit Zeitstempel unverändert bewahren; ID, Manager, Wettbewerb, Abgabezeit und Marktwert explizit prüfen.
3. Discord-basierte Wiederherstellung nach Hosting-Deploys berücksichtigen. Idempotenz gegen doppelte Events und falsche Wiederherstellung sicherstellen.
4. Mehrdeutige Spielernamen nicht automatisch zuordnen. Bei Kickbase-Ausfall Abgabe zulassen und fehlenden Marktwert transparent markieren.
5. Keine echten Abgaben, Fristprüfungen oder Reset-Commands zum Test auslösen. Bei Datenmigration zuerst Backup-/Rollback-Plan skizzieren.
6. Tests: gültig/ungültig/doppelt, Neustart, fehlende API, Historie, Berechtigungen. Ergebnisse und Grenzen dokumentieren.

Quelle/Adaption: [prompts.chat](https://github.com/f/prompts.chat), offene Prompt-Daten CC0 1.0. Projektbezogen neu formuliert.
