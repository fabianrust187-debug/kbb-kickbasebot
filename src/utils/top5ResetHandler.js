import { PermissionFlagsBits } from "discord.js";
import { buildErrorEmbed, buildSuccessEmbed } from "./embeds.js";
import { getGuildSettings } from "./guildSettings.js";
import { ensureTop5SubmitButton } from "./top5Button.js";
import { resetTop5Round } from "./top5Store.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";

function hasManageServerPermission(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function getTop5ChannelId(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
}

export async function runTop5ResetWithUi(interaction) {
  if (!interaction.guildId || !interaction.guild) {
    return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  }

  if (!hasManageServerPermission(interaction)) {
    return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const result = resetTop5Round(interaction.guildId, interaction.user);
  if (!result.ok) {
    return interaction.editReply({ embeds: [buildErrorEmbed(result.error || "Reset fehlgeschlagen.")] });
  }

  const channelId = getTop5ChannelId(interaction.guildId);
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased?.()) {
    return interaction.editReply({
      embeds: [buildErrorEmbed(`Runde wurde zurückgesetzt, aber der Top-5-Channel <#${channelId}> konnte nicht geladen werden.`)],
    });
  }

  await channel.send({
    content: "🔄 **Neue Top-5-Runde gestartet.**\nDie nächste Top-5-Abgabe kann ab sofort eingereicht werden.",
    allowedMentions: { parse: [] },
  }).catch(() => null);

  const button = await ensureTop5SubmitButton(interaction.guild, { channelId }).catch(() => null);

  return interaction.editReply({
    embeds: [buildSuccessEmbed(
      "🔄 Top-5-Runde zurückgesetzt",
      [
        `Neue Runde gestartet. Channel: <#${channelId}>`,
        button?.ok
          ? "✅ Der neue Abgabe-Button wurde sofort aktualisiert."
          : "⚠️ Die Runde wurde zurückgesetzt, der Button konnte aber nicht sofort aktualisiert werden. Der Scheduler versucht es automatisch erneut.",
      ].join("\n"),
    )],
  });
}
