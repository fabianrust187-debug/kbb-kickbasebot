# prompts.chat – Projekt-Prompts

Hier liegen speziell auf **fabianrust187-debug/kbb-kickbasebot** zugeschnittene Arbeitsanweisungen, inspiriert von den offenen [prompts.chat](https://github.com/f/prompts.chat)-Prompt-Daten (CC0 1.0).

## Nutzung
- Projektkontext und Zuordnung: [AGENTS.md](../../AGENTS.md).
- In kompatiblen Coding-Agents wird `AGENTS.md` als Projektkontext gelesen. Für die jeweilige Aufgabe die verlinkte `.prompt.md`-Datei hinzunehmen.
- Bei GitHub Copilot in unterstützten Umgebungen kann eine `.prompt.md`-Datei als Prompt ausgeführt/angehängt werden.
- Bei ChatGPT lassen sich die Dateien über den verbundenen GitHub-Zugriff lesen, wenn am Repository gearbeitet wird.
- Es handelt sich um **keine** automatisch aktive ChatGPT-MCP-Integration; die Dateien sind Dokumentation und ändern den Live-Code nicht.

## Vorlagen
- [01-discord-commands](./01-discord-commands.prompt.md) – Kickbase-Bot Commands, Buttons und Nutzerführung verbessern
- [02-top5-data-integrity](./02-top5-data-integrity.prompt.md) – Top-5-Abgaben, Fristen und Datenwiederherstellung vor Regression schützen
- [03-kickbase-api-debug](./03-kickbase-api-debug.prompt.md) – Kickbase-Lesezugriff und Marktwertauflösung sicher debuggen
- [04-release-deadlines](./04-release-deadlines.prompt.md) – Top-5-Frist am Dienstag, Zeitzonen und Releases sicher prüfen

Vorlagen sind bewusst selektiv und projektspezifisch, keine komplette 6-MB-Kopie des Original-Datensatzes. Bei Änderungen sind tatsächliche Prüfungen und Risiken zu dokumentieren.
