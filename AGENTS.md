# AGENTS.md — KBB Kickbase Discord Bot

## Ziel
Pflege den Discord-Bot der **187 KICKBASEBANDE**, inklusive Top-5-Einreichungen, Managerverwaltung und Kickbase-Leseintegration. Bestehende Daten und Liga-Regeln erhalten.

## Projektkontext
- Node.js (laut `package.json` >=18), ESM JavaScript, discord.js 14. `npm start` startet den Bot; `npm run register` registriert Slash-Commands.
- Siehe `README.md`, `docs/`, `src/commands/`, `src/utils/` und `src/data/` für tatsächliches Verhalten.
- Top-5-Frist laut README: Dienstag 22:00 Uhr, Zeitzone `Europe/Berlin`; Winter-/Sommerzeit beachten.
- Kickbase-Anbindung dient derzeit nur dem **Lesen** von Spieleridentität und Marktwerten. Keine Käufe, Verkäufe oder Transfers hinzufügen ohne explizite Zustimmung.

## Task-Prompts
Passende Datei unter `.github/prompts/` lesen:
- `01-discord-commands.prompt.md`: Command-Design und Discord-Bedienung.
- `02-top5-data-integrity.prompt.md`: Top-5-Abgaben, Historie, Wiederherstellung, Marktwerte.
- `03-kickbase-api-debug.prompt.md`: Auth, API-Fehler, Mehrdeutigkeiten, Lesezugriff.
- `04-release-deadlines.prompt.md`: Fristen, Zeitzonen, Release- und Regressionstest.

## Regeln
1. Vor Eingriffen reale Commands, Datenmodelle und bestehenden Wiederherstellungsmechanismus lesen.
2. Fristen, Abgabezeitpunkte und historische Marktwerte unverfälscht behandeln. Keine produktiven Datenbanken/Discord-Archive oder Message-Historie bei Tests verändern.
3. Mehrdeutige Spielerzuordnungen nicht raten. Fällt Kickbase aus, weiterhin valide Abgaben ermöglichen, Marktwert sauber als nicht verfügbar kennzeichnen.
4. Token, Login und personenbezogene Daten niemals in Commits/Logs/Embeds offenlegen; minimale Discord-Berechtigungen, Admin-Prüfungen, Ephemeral Replies.
5. Keine Live-Registrierung von Commands, reale Frist-Auswertung, Nachrichtenversand oder Deploy ohne ausdrücklichen Auftrag.
6. Syntaxchecks für veränderte JavaScript-Dateien und gezielte Tests durchführen, soweit möglich; Ausfälle und Nichtprüfungen transparent ausweisen.
7. Änderungsergebnis mit Dateiliste, Teststatus und verbleibenden Risiken melden.

## Herkunft
Projektbezogene Adaption bewährter Prompt-Prinzipien aus https://github.com/f/prompts.chat (CC0-Prompt-Daten); die Dateien sind Anleitungen, keine automatisch aktiven Bot-Kommandos.
