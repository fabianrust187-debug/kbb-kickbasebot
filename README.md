# KBB Kickbase Bot

Discord Bot für die **187 KICKBASEBANDE** Kickbase-Liga.

## Aktuelle Features

- `/ping` — Bot-Status prüfen
- `/kbb help` — Command-Übersicht
- `/kbb rules` — Regelwerk für Saison 26/27
- `/kbb league` — Liga-Infos und Setup-Status
- `/kbb name` — eigenen Discord-Servernickname auf den Kickbase-Namen setzen
- `/kbb top5` — Top-5-Spieler über ein privates Formular abgeben
- **🎯 Spieler abgeben** — Button im Top-5-Channel als komfortable Alternative zu `/kbb top5`
- `/kbb top5-status` — aktuelle Abgaben inklusive gespeichertem Marktwert anzeigen
- `/kbb top5-history` — historische Top-5-Abgaben und Marktwerte abrufen
- `/kbb top5-missing` — fehlende/verspätete Abgaben manuell auswerten
- `/kbb top5-reset` — neue Runde manuell starten
- `/kbb manager-add`, `/kbb manager-remove`, `/kbb manager-list` — Managerverwaltung
- `/kbb setup` — relevante Discord-Channels konfigurieren
- automatische Top-5-Fristprüfung jeden **Dienstag um 22:00 Uhr (Europe/Berlin)**
- Discord-basierte Wiederherstellung von Managerliste und Top-5-Daten nach Deploys
- read-only Kickbase-Anbindung für Spielerauflösung und Marktwert-Snapshots

## Top-5-Marktwerte

Bei einer neuen Top-5-Abgabe versucht der Bot den eingegebenen Spielernamen über Kickbase aufzulösen. Bei erfolgreicher Zuordnung werden zusammen mit der Abgabe gespeichert:

- Kickbase-Spieler-ID
- aufgelöster Spielername
- Marktwert zum Zeitpunkt der Abgabe
- Zeitpunkt des Marktwert-Abrufs
- Wettbewerb und Liga, soweit verfügbar
- Discord-Manager und Abgabezeitpunkt

Die öffentliche Abgabe im Top-5-Channel enthält ebenfalls den Marktwert. Dadurch kann der Bot die Daten nach einem Hosting-Deploy aus Discord rekonstruieren.

Wenn ein Name mehrdeutig ist, wird die Abgabe nicht automatisch einem möglicherweise falschen Spieler zugeordnet. Der Nutzer erhält stattdessen mögliche Treffer und soll den Namen genauer eingeben.

Wenn die Kickbase-Schnittstelle vorübergehend nicht erreichbar oder nicht konfiguriert ist, wird die eigentliche Top-5-Abgabe weiterhin angenommen, damit die Frist nicht wegen eines API-Problems verpasst wird. In diesem Fall steht der Marktwert auf `nicht verfügbar`.

## Setup

### 1. Dependencies installieren

```bash
npm install
```

### 2. Environment-Datei erstellen

```bash
cp .env.example .env
```

Mindestens erforderlich:

```env
DISCORD_TOKEN=dein_discord_bot_token
CLIENT_ID=deine_application_client_id
GUILD_ID=deine_discord_server_id
TOP5_CHANNEL_ID=deine_top5_channel_id
TOP5_MANAGER_TARGET=14
```

### 3. Kickbase-Lesezugriff konfigurieren

Bundesliga:

```env
KICKBASE_COMPETITION_ID=1
KICKBASE_LEAGUE_NAME=187 KICKBASEBANDE
```

Wenn die Kickbase-Liga-ID bekannt ist, kann sie zusätzlich direkt gesetzt werden:

```env
KICKBASE_LEAGUE_ID=
```

Für die Authentifizierung gibt es zwei Möglichkeiten.

**Variante A — Bearer Token:**

```env
KICKBASE_TOKEN=
```

**Variante B — automatischer Login:**

```env
KICKBASE_EMAIL=
KICKBASE_PASSWORD=
```

Bei Variante B kann der Bot nach einem abgelaufenen Token erneut einen Login durchführen.

> **Wichtig:** Echte Discord- oder Kickbase-Tokens, E-Mail-Adressen und Passwörter niemals in GitHub committen. Auf Discloud ausschließlich unter **Variables / Environment Variables** speichern.

Die Kickbase-Anbindung ist im Bot ausschließlich zum Lesen von Spieler- und Marktwertdaten vorgesehen. Es werden keine Käufe, Verkäufe oder sonstigen Transferaktionen über die Schnittstelle ausgeführt.

### 4. Commands registrieren

```bash
npm run register
```

### 5. Bot starten

```bash
npm start
```

## Discord Bot Invite

OAuth2-Link mit den für den Server vorgesehenen Berechtigungen erzeugen und dabei `bot` sowie `applications.commands` als Scopes aktivieren.

## Projektstruktur

```txt
src/
├─ bot.js
├─ registerCommands.js
├─ commands/
│  ├─ ping.js
│  └─ kbb.js
├─ utils/
│  ├─ embeds.js
│  ├─ guildSettings.js
│  ├─ kickbaseApi.js
│  ├─ managerStore.js
│  ├─ top5Button.js
│  ├─ top5ButtonHandler.js
│  ├─ top5Deadline.js
│  ├─ top5History.js
│  ├─ top5Recovery.js
│  ├─ top5Store.js
│  └─ top5SubmissionService.js
└─ data/
   ├─ guildSettings.json
   ├─ managerRoster.json
   └─ top5Submissions.json
```

## Hinweise zur Datenhaltung

Lokale JSON-Dateien dienen als schnelle Laufzeitablage. Da Hosting-Deploys lokale Dateien ersetzen können, spiegelt der Bot wichtige Manager- und Top-5-Daten zusätzlich über seine eigenen Discord-Nachrichten. Das ermöglicht eine automatische Wiederherstellung nach Updates.

Historische Top-5-Werte können über `/kbb top5-history` wieder aufgerufen werden.
