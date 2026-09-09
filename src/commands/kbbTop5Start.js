import { PermissionFlagsBits } from "discord.js";
import { buildErrorEmbed, buildSuccessEmbed } from "../utils/embeds.js";
import { startTop5Round } from "../utils/top5RoundStart.js";

function hasManageServerPermission(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

export async function runTop5Start(interaction) {
  if (!interaction.guildId || !interaction.guild) {
    return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  }

  if (!hasManageServerPermission(interaction)) {
    return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await startTop5Round(interaction.guild, interaction.user, { source: "manual" });

  if (!result.ok) {
    return interaction.editReply({ embeds: [buildErrorEmbed(result.error || "Neue Top-5-Runde konnte nicht gestartet werden.")] });
  }

  return interaction.editReply({
    embeds: [buildSuccessEmbed(
      "✅ Neue Top-5-Runde gestartet",
      [
        `Channel: <#${result.channelId}>`,
        "🎯 Der Abgabe-Button wurde für die neue Runde bereitgestellt.",
        "⏰ Frist: Dienstag, 22:00 Uhr.",
        "",
        "Dieser Befehl ist für englische Wochen oder andere manuelle Sonderstarts gedacht.",
      ].join("\n"),
    )],
  });
}
