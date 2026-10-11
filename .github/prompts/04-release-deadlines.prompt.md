---
description: "Top-5-Frist am Dienstag, Zeitzonen und Releases sicher prüfen"
---
# Fristen, Zeitzonen und Release-QA

Diese Prompt-Vorlage auf einen konkreten Arbeitsauftrag im **bestehenden Repository** anwenden. Gegebene Fakten und Hypothesen unterscheiden.

1. Release/Problem: [Änderung]. Prüfe betroffene Dateipfade, `README.md`, Timer/Deadline-Funktionen und Konfiguration.
2. Offizielle Liga-Regeln aus Projektdateien beachten. Laut README Frist Dienstag 22:00 Uhr in `Europe/Berlin`; Sommer- und Winterzeit und Server-Neustarts testen.
3. Deadline-Funktionen gegen doppelte Ausführung, verlorene Timer, fehlende Manager und API-Ausfälle absichern.
4. Manager-, Top-5- und Discord-Archivdaten dürfen bei Deploys oder Tests nicht versehentlich überschrieben werden.
5. Für geänderte JS-Dateien Syntaxprüfung ausführen, soweit verfügbar; keine Live-Frist-Checks oder Command-Registrierung ohne Auftrag.
6. Releasebericht: Regressionen, Teststatus, Risiken und notwendige Konfiguration; keine ungetestete Freigabe behaupten.

Quelle/Adaption: [prompts.chat](https://github.com/f/prompts.chat), offene Prompt-Daten CC0 1.0. Projektbezogen neu formuliert.
