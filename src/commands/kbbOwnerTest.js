import { PermissionFlagsBits } from "discord.js";
import { buildErrorEmbed, buildKbbEmbed } from "../utils/embeds.js";
import {
  findOwnerInOwnershipSnapshot,
  findSimilarOwnershipPlayers,
  getReliableKickbaseOwnership,
} from "../utils/kickbaseOwnershipReliable.js";

function hasAdminPermission(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

const OWNER_TEST_TIMEOUT_MS = 45_000;

async function getOwnerSnapshotWithTimeout() {
  let timer;
  try {
    return await Promise.race([
      // Prefer a recently verified ownership snapshot instead of initiating
      // a new complete league scan every time the diagnostic is used.
      getReliableKickbaseOwnership(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("OWNER_TEST_TIMEOUT")), OWNER_TEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runKickbaseOwnerTest(interaction) {
  // The main interaction handler acknowledges first, but the command also
  // supports direct invocation without attempting a second defer.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  if (!interaction.guildId || !interaction.guild) {
    return interaction.editReply({ embeds: [buildErrorEmbed("Nur auf dem KBB-Server nutzbar.")] });
  }

  if (!hasAdminPermission(interaction)) {
    return interaction.editReply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")] });
  }

  const playerName = String(interaction.options.getString("spieler", true) || "").trim();
  console.log(`🔎 Kickbase owner-test started: player="${playerName}", guild=${interaction.guildId}`);

  let snapshot;
  try {
    snapshot = await getOwnerSnapshotWithTimeout();
  } catch (error) {
    const timedOut = error?.message === "OWNER_TEST_TIMEOUT";
    console.error(`❌ Kickbase owner-test failed: player="${playerName}" ${timedOut ? "timeout after 45s" : error?.message || error}`);
    return interaction.editReply({ embeds: [buildErrorEmbed([
      timedOut
        ? "⏱️ Die Kickbase-Besitzerabfrage dauert länger als 45 Sekunden. Discord funktioniert, aber die Liga-Kader konnten nicht rechtzeitig geladen werden."
        : "Die Kickbase-Besitzerprüfung ist fehlgeschlagen.",
      "",
      "Bitte in Discloud die Protokolle nach `Kickbase owner health`, `Kickbase squad` oder `Kickbase ownership source failed` durchsuchen.",
      "Die bestehende Abfrage darf im Hintergrund noch abschließen. Wiederhole den Test danach.",
      "",
      "Keine Zugangsdaten oder Tokens teilen.",
    ].join("\n"))] });
  }

  if (!snapshot.ok) {
    console.warn(`⚠️ Kickbase owner-test incomplete for ${playerName}: ${snapshot.error || snapshot.code}`);
    return interaction.editReply({ embeds: [buildErrorEmbed([
      "Kickbase-Besitzerauflösung ist aktuell nicht vollständig. Der Liveticker wartet mit neuen Meldungen, bis die Besitzer wieder zuverlässig geladen werden.",
      "",
      `**Fehler:** ${snapshot.error || "Unbekannter Fehler"}`,
      `**Manager erkannt:** ${snapshot.managers?.length ?? "nicht verfügbar"}`,
      `**Manager mit Kader:** ${snapshot.managersWithRoster ?? "nicht verfügbar"}`,
      `**Kaderspieler:** ${snapshot.squadPlayerCount ?? "nicht verfügbar"}`,
      `**Live-Spieler:** ${snapshot.livePlayerCount ?? "nicht verfügbar"}`,
      "",
      "Bitte die Discloud-Logs mit `Kickbase owner health` oder `Kickbase squad` prüfen. Zugangsdaten nicht teilen.",
    ].join("\n"))] });
  }

  const owner = findOwnerInOwnershipSnapshot(playerName, snapshot);
  const similar = findSimilarOwnershipPlayers(playerName, snapshot, 6);
  console.log(`✅ Kickbase owner-test finished: ${playerName} -> ${owner?.managerName || "no owner"}; managers=${snapshot.managers.length}; rosters=${snapshot.managersWithRoster}; players=${snapshot.players.length}`);

  const lines = [
    `**Gesucht:** ${playerName}`,
    "",
    `**Liga:** ${snapshot.leagueName} (\`${snapshot.leagueId}\`)`,
    `**Manager erkannt:** ${snapshot.managers?.length || 0}`,
    `**Manager mit erkanntem Kader:** ${snapshot.managersWithRoster || 0}`,
    `**Kaderspieler geladen:** ${snapshot.squadPlayerCount || 0}`,
    `**Live-Spieler geladen:** ${snapshot.livePlayerCount || 0}`,
    `**Zusammengeführte Spieler:** ${snapshot.players?.length || 0}`,
    `**Stand:** ${snapshot.fetchedAt || "unbekannt"}`,
    "",
  ];

  if (owner) {
    lines.push(
      "## ✅ Besitzer gefunden",
      `**Spieler:** ${owner.playerName}`,
      `**Kickbase-Manager:** ${owner.managerName}`,
      `**Manager-ID:** \`${owner.managerId}\``,
      owner.playerId ? `**Spieler-ID:** \`${owner.playerId}\`` : "",
      Number.isFinite(owner.livePoints) ? `**Livepunkte:** ${owner.livePoints}` : "",
    );
  } else {
    lines.push(
      "## ❌ Kein eindeutiger Besitzer gefunden",
      "Der Spieler ist entweder frei, wurde im Kader-Snapshot nicht erkannt oder der Name ist nicht eindeutig.",
    );
    if (similar.length) {
      lines.push(
        "",
        "**Ähnliche geladene Spieler:**",
        ...similar.map(player => `• ${player.playerName} → **${player.managerName}**`),
      );
    }
  }

  return interaction.editReply({ embeds: [buildKbbEmbed({
    title: "🔎 Kickbase Besitzer-Test",
    description: lines.filter(Boolean).join("\n"),
    footer: "187 KICKBASEBANDE • Ownership Diagnose",
  })] });
}
