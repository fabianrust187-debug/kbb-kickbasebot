# KBB Kickbase Bot

Discord Bot für die **187 KICKBASEBANDE** Kickbase-Liga.

## Features in Version 0.1.0

- `/ping` — Bot-Status prüfen
- `/kbb help` — Command-Übersicht
- `/kbb rules` — Regelwerk für die Saison 26/27 posten
- `/kbb league` — Liga-Infos anzeigen
- `/kbb setup` — Rules-/Announcement-Channel speichern

## Setup

### 1. Dependencies installieren

```bash
npm install
```

### 2. Environment-Datei erstellen

```bash
cp .env.example .env
```

Danach `.env` ausfüllen:

```env
DISCORD_TOKEN=dein_bot_token
CLIENT_ID=deine_application_client_id
GUILD_ID=deine_discord_server_id
```

`GUILD_ID` ist für die Entwicklung empfohlen, weil Slash Commands dann sofort auf diesem Server registriert werden.

### 3. Commands registrieren

```bash
npm run register
```

### 4. Bot starten

```bash
npm start
```

## Discord Bot Invite

OAuth2-Link mit Admin-Rechten:

```txt
https://discord.com/oauth2/authorize?client_id=DEINE_CLIENT_ID&permissions=8&integration_type=0&scope=bot+applications.commands
```

`DEINE_CLIENT_ID` durch die Application / Client ID aus dem Discord Developer Portal ersetzen.

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
│  └─ guildSettings.js
└─ data/
   └─ guildSettings.json
```

## Nächste geplante Module

- Strafenkatalog
- Top-5-Verkauf-Erinnerung
- Managerliste
- Spieltagsverwaltung
- Transfer-/Underpay-Check
- automatische Ankündigungen
