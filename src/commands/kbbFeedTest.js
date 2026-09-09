import { PermissionFlagsBits } from "discord.js";
import { buildErrorEmbed, buildKbbEmbed, buildSuccessEmbed } from "../utils/embeds.js";
import { formatTransferPrice, getLatestLeagueTransfers } from "../utils/kickbaseFeed.js";

const TEST_CHANNEL_ID = process.env.KBB_TEST_CHANNEL_ID || "1522249317656690929";

function hasManageServerPermission(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function escapeDiscordText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`>|])/g, "\\$1");
}

function formatWhen(createdAt) {
  if (!createdAt) return "Zeitpunkt unbekannt";
  const timestamp = Math.floor(new Date(createdAt).getTime() / 1000);
  if (!Number.isFinite(timestamp)) return "Zeitpunkt unbekannt";
  return `<t:${timestamp}:f> • <t:${timestamp}:R>`;
}

function transferLine(transfer, index) {
  const buyer = escapeDiscordText(transfer.buyer);
  const seller = escapeDiscordText(transfer.seller);
  const player = escapeDiscordText(transfer.playerName);
  const price = formatTransferPrice(transfer.price);

  const source = transfer.seller === "KICKBASE"
    ? "vom **KICKBASE-Markt**"
    : `von **${seller}**`;

  return [
    `### ${index + 1}. 💸 ${player}`,
    `**${buyer}** hat **${player}** ${source} für **${price}** gekauft.`,
    formatWhen(transfer.createdAt),
  ].join("\n");
}

export async function runKickbaseFeedTest(interaction) {
  if (!interaction.guildId || !interaction.guild) {
    return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  }

  if (!hasManageServerPermission(interaction)) {
    return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const amount = interaction.options.getInteger("anzahl") || 10;
  const channel = await interaction.guild.channels.fetch(TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return interaction.editReply({
      embeds: [buildErrorEmbed(`Testkanal <#${TEST_CHANNEL_ID}> wurde nicht gefunden oder ist nicht beschreibbar.`)],
    });
  }

  const result = await getLatestLeagueTransfers({ limit: amount });
  if (!result.ok) {
    return interaction.editReply({ embeds: [buildErrorEmbed([
      "Kickbase-Transferfeed konnte nicht geladen werden.",
      "",
      `**Fehler:** ${result.error || "Unbekannter Fehler"}`,
      result.code ? `**Code:** \`${result.code}\`` : "",
    ].filter(Boolean).join("\n"))] });
  }

  const description = result.transfers.length
    ? [
        `Live aus **${escapeDiscordText(result.leagueName)}** • Liga-ID \`${result.leagueId}\``,
        "",
        ...result.transfers.map(transferLine),
      ].join("\n\n")
    : [
        `Live aus **${escapeDiscordText(result.leagueName)}** • Liga-ID \`${result.leagueId}\``,
        "",
        "Im aktuell geladenen Kickbase-Feed wurden keine Kauf-Transfers gefunden.",
      ].join("\n");

  const embed = buildKbbEmbed({
    title: "🧪 Kickbase Transfer-Feed — TEST",
    description,
    footer: `187 KICKBASEBANDE • nur Testkanal • ${result.transfers.length} Transfer(s)`,
  });

  const sent = await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!sent) {
    return interaction.editReply({ embeds: [buildErrorEmbed("Transfer-Feed konnte nicht in den Testkanal gepostet werden.")] });
  }

  return interaction.editReply({
    embeds: [buildSuccessEmbed(
      "✅ Transfer-Feed getestet",
      `Die neuesten **${result.transfers.length}** Kauf-Transfers wurden ausschließlich in <#${TEST_CHANNEL_ID}> ausgegeben.`,
    )],
  });
}
