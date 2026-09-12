import { PermissionFlagsBits } from "discord.js";
import { buildErrorEmbed, buildKbbEmbed } from "../utils/embeds.js";
import { getGuildSettings } from "../utils/guildSettings.js";
import { getKickbaseConnectionInfo } from "../utils/kickbaseInfo.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";
const DEFAULT_TEST_CHANNEL_ID = process.env.KBB_TEST_CHANNEL_ID || "1522249317656690929";
const DEFAULT_TRANSFER_CHANNEL_ID = process.env.KBB_TRANSFER_CHANNEL_ID || "1522249401735839784";
const DEFAULT_GOAL_CHANNEL_ID = process.env.KBB_GOAL_CHANNEL_ID || "1522249187666952254";

function hasManageServerPermission(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function getTop5ChannelId(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
}

function authLabel(method) {
  if (method === "email_password") return "E-Mail + Passwort";
  if (method === "token") return "Token";
  return "unbekannt";
}

export async function runKickbaseInfo(interaction) {
  if (!interaction.guildId || !interaction.guild) {
    return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  }

  if (!hasManageServerPermission(interaction)) {
    return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const info = await getKickbaseConnectionInfo();

  if (!info.ok) {
    return interaction.editReply({ embeds: [buildErrorEmbed([
      "Kickbase-Verbindung konnte nicht hergestellt werden.",
      "",
      `**Fehler:** ${info.error || "Unbekannter Fehler"}`,
      info.code ? `**Code:** \`${info.code}\`` : "",
      "",
      "Bitte die Kickbase-Variablen in Discloud prüfen und den Bot anschließend neu starten.",
    ].filter(Boolean).join("\n"))] });
  }

  const lines = [
    "✅ **Kickbase API erreichbar und Anmeldung erfolgreich.**",
    "",
    `**Authentifizierung:** ${authLabel(info.authMethod)}`,
    `**Competition-ID:** \`${info.competitionId}\``,
    `**Gesuchte Liga:** ${info.configuredLeagueName || "nicht gesetzt"}`,
    `**Gefundene Ligen:** ${info.leagueCount}`,
    "",
  ];

  if (info.leagueFound && info.league) {
    lines.push(
      "## ✅ Liga gefunden",
      `**Liga:** ${info.league.name}`,
      `**Liga-ID:** \`${info.league.id}\``,
      "**Marktwert-/Live-Anbindung:** ✅ bereit für Top-5 und Bundesliga-Livefeed",
      "",
    );

    if (!info.configuredLeagueId) {
      lines.push(
        "💡 Die Liga-ID wurde automatisch über den Liga-Namen gefunden. Du kannst sie optional in Discloud fest hinterlegen:",
        `\`KICKBASE_LEAGUE_ID=${info.league.id}\``,
      );
    } else {
      lines.push("✅ `KICKBASE_LEAGUE_ID` ist bereits gesetzt.");
    }
  } else {
    lines.push(
      "## ⚠️ Liga nicht eindeutig gefunden",
      "Die Anmeldung funktioniert, aber keine Liga passt exakt zu `KICKBASE_LEAGUE_NAME` bzw. `KICKBASE_LEAGUE_ID`.",
      "",
    );

    if (info.leagues?.length) {
      lines.push(
        "**Verfügbare Ligen:**",
        ...info.leagues.slice(0, 10).map(league => `• **${league.name}** — ID: \`${league.id || "unbekannt"}\``),
        "",
        "Setze danach `KICKBASE_LEAGUE_NAME` exakt auf den Namen oder `KICKBASE_LEAGUE_ID` auf die passende ID.",
      );
    } else {
      lines.push("Es wurden keine Ligen für diesen Kickbase-Account zurückgegeben.");
    }
  }

  return interaction.editReply({ embeds: [buildKbbEmbed({
    title: "🔌 Kickbase-Verbindung",
    description: lines.join("\n"),
    footer: "187 KICKBASEBANDE • Kickbase Diagnose",
  })] });
}

export async function runKbbHelp(interaction) {
  const top5ChannelId = getTop5ChannelId(interaction.guildId);

  const embed = buildKbbEmbed({
    title: "📘 KBB Bot Help",
    description: [
      "**Commands**",
      "• `/ping` — Bot-Status prüfen",
      "• `/kbb help` — Übersicht anzeigen",
      "• `/kbb rules` — Regelwerk anzeigen",
      "• `/kbb league` — Liga-Infos anzeigen",
      "• `/kbb name` — Kickbase-Namen in einem privaten Fenster eintragen",
      "• `/kbb top5` — private Top-5-Abgabe starten",
      "• `/kbb top5-status` — Abgabestand inklusive Marktwert anzeigen",
      "• `/kbb top5-history` — gespeicherte Top-5-Abgaben und Marktwerte abrufen",
      "• `/kbb top5-missing` — Fristprüfung manuell posten *(Admin)*",
      "• `/kbb top5-start` — neue Runde manuell starten, z. B. englische Woche *(Admin)*",
      "• `/kbb top5-reset` — aktuelle Runde zurücksetzen *(Admin)*",
      "• `/kbb manager-add` — Manager zur Teilnehmerliste hinzufügen *(Admin)*",
      "• `/kbb manager-remove` — Manager entfernen *(Admin)*",
      "• `/kbb manager-list` — Teilnehmerliste anzeigen",
      "• `/kbb kickbase-info` — Kickbase-Verbindung und Liga-ID prüfen *(Admin)*",
      "• `/kbb owner-test spieler:<Name>` — Kickbase-Besitzerauflösung eines Spielers prüfen *(Admin)*",
      "• `/kbb feed-test` — neueste Kickbase-Käufe nur im Testkanal ausgeben *(Admin)*",
      "• `/kbb setup` — Channels setzen *(Admin)*",
      "",
      `**Top-5-Abgabe Channel:** <#${top5ChannelId}>`,
      `**Transfermarkt Live-Feed:** <#${DEFAULT_TRANSFER_CHANNEL_ID}> — automatische Prüfung jede Minute`,
      `**Bundesliga Livefeed:** <#${DEFAULT_GOAL_CHANNEL_ID}> — Prüfung ca. alle **30 Sekunden**`,
      `**Feature-Test Channel:** <#${DEFAULT_TEST_CHANNEL_ID}>`,
      "Der Bundesliga-Livefeed meldet Tore, Vorlagen, rote/gelb-rote Karten und ausdrücklich verletzungsbedingte Auswechslungen.",
      "Neue Tore werden kurz gesammelt und Informationen aus ESPN Scoring-Plays, Key-Events, Matchdetails und Commentary zusammengeführt, damit Spielstand und Vorlagengeber möglichst vollständig in einer einzigen Meldung erscheinen.",
      "Die Besitzerzuordnung ermittelt die Liga-Manager über Overview/Ranking und lädt anschließend deren vollständige Kickbase-Kader; doppelte Live-/Kaderdatensätze desselben Besitzers werden dabei nicht mehr als Mehrdeutigkeit behandelt.",
      "Nach Restart/Deploy werden bereits vorhandene Ereignisse des laufenden Spiels als Ausgangsstand übernommen und nicht erneut nachgepostet.",
      "**Kartenscoring:** Rot **-75**, Gelb-Rot **-50** Kickbase-Punkte.",
      "**Regulärer Rundenstart:** Freitag um **20:00 Uhr (Europe/Berlin)**.",
      "**Abgabefrist:** Dienstag um **22:00 Uhr (Europe/Berlin)**.",
      "Nach der Dienstagsfrist bleibt der Abgabe-Button weg, bis die nächste Runde am Freitag startet.",
    ].join("\n"),
  });

  return interaction.reply({ embeds: [embed], ephemeral: true });
}
