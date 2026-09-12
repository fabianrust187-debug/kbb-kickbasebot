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

export async function runKickbaseOwnerTest(interaction) {
  if (!interaction.guildId || !interaction.guild) {
    return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  }

  if (!hasAdminPermission(interaction)) {
    return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });
  }

  const playerName = String(interaction.options.getString("spieler", true) || "").trim();
  await interaction.deferReply({ ephemeral: true });

  const snapshot = await getReliableKickbaseOwnership({ force: true });
  if (!snapshot.ok) {
    return interaction.editReply({ embeds: [buildErrorEmbed([
      "Kickbase-Besitzerauflösung fehlgeschlagen.",
      "",
      `**Fehler:** ${snapshot.error || "Unbekannter Fehler"}`,
    ].join("\n"))] });
  }

  const owner = findOwnerInOwnershipSnapshot(playerName, snapshot);
  const similar = findSimilarOwnershipPlayers(playerName, snapshot, 6);

  const lines = [
    `**Gesucht:** ${playerName}`,
    "",
    `**Liga:** ${snapshot.leagueName} (\`${snapshot.leagueId}\`)`,
    `**Manager erkannt:** ${snapshot.managers?.length || 0}`,
    `**Kaderspieler geladen:** ${snapshot.squadPlayerCount || 0}`,
    `**Live-Spieler geladen:** ${snapshot.livePlayerCount || 0}`,
    `**Zusammengeführte Spieler:** ${snapshot.players?.length || 0}`,
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
