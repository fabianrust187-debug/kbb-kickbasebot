import { PermissionFlagsBits } from "discord.js";
import { buildErrorEmbed } from "../utils/embeds.js";
import { getGuildSettings } from "../utils/guildSettings.js";
import { formatMarketValue } from "../utils/kickbaseApi.js";
import { fetchTop5ChannelHistory, parseTop5SubmissionMessage } from "../utils/top5Recovery.js";
import { getTop5SubmissionForUser } from "../utils/top5Store.js";
import {
  formatTop5SubmissionLine,
  retryMissingTop5MarketValue,
} from "../utils/top5SubmissionService.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";

function isAdmin(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function top5ChannelId(guildId) {
  return getGuildSettings(guildId).top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
}

function originalSubmissionMessage(messages, botId, userId) {
  const botMessages = messages.filter(message => message.author?.id === botId);
  let lastStart = -1;
  for (let i = 0; i < botMessages.length; i++) {
    if (String(botMessages[i].content || "").includes("Neue Top-5-Runde gestartet")) lastStart = i;
  }
  const current = lastStart < 0 ? botMessages : botMessages.slice(lastStart + 1);
  return [...current].reverse()
    .find(message => parseTop5SubmissionMessage(message)?.userId === String(userId)) || null;
}

export async function runTop5MarketValueRetry(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  if (!interaction.guild) {
    return interaction.editReply({ embeds: [buildErrorEmbed("Nur auf dem KBB-Server nutzbar.")] });
  }

  const selected = interaction.options.getUser("manager");
  const userId = selected?.id || interaction.user.id;
  if (userId !== interaction.user.id && !isAdmin(interaction)) {
    return interaction.editReply({ embeds: [buildErrorEmbed("Du darfst nur deinen eigenen Marktwert erneut abrufen.")] });
  }

  const previous = getTop5SubmissionForUser(interaction.guildId, userId);
  if (!previous) {
    return interaction.editReply({ content: "❌ Für diesen Manager gibt es in der aktuellen Runde keine Top-5-Abgabe." });
  }

  if (previous.marketValue !== null && previous.marketValue !== undefined) {
    return interaction.editReply({
      content: `✅ Für **${previous.playerName}** ist bereits ein Marktwert gespeichert: **${formatMarketValue(previous.marketValue)}**.`,
    });
  }

  const result = await retryMissingTop5MarketValue(interaction.guildId, userId);
  if (!result.ok) {
    const suggestions = result.suggestions?.length
      ? `\nMögliche Treffer: ${result.suggestions.slice(0, 5).join(", ")}`
      : "";
    return interaction.editReply({
      content: `❌ Marktwert für **${previous.playerName}** konnte weiterhin nicht geladen werden.\n**Grund:** ${result.error || result.code || "Kickbase-API derzeit nicht verfügbar."}${suggestions}\n\nDie ursprüngliche Abgabe bleibt unverändert gespeichert. Versuche es später erneut.`,
    });
  }

  const channelId = top5ChannelId(interaction.guildId);
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  let durable = false;
  let updatedOriginal = false;
  if (channel?.isTextBased?.() && channel.messages?.fetch) {
    const messages = await fetchTop5ChannelHistory(channel, 500).catch(() => []);
    const oldMessage = originalSubmissionMessage(messages, interaction.client.user.id, userId);
    const publicLine = `${formatTop5SubmissionLine(userId, result.submission)} • 💰 *Marktwert nachträglich ermittelt*`;

    if (oldMessage?.edit) {
      durable = await oldMessage.edit({
        content: publicLine,
        allowedMentions: { parse: [] },
      }).then(() => true).catch(() => false);
      updatedOriginal = durable;
    }

    if (!durable) {
      // Keep the original submission timestamp for recovery even if the
      // original message is too old or cannot be edited.
      const originalTs = Math.floor(new Date(previous.createdAt).getTime() / 1000);
      const fallbackLine = `${publicLine} • ursprüngliche Abgabe: <t:${originalTs}:f>`;
      durable = !!(await channel.send({
        content: fallbackLine,
        allowedMentions: { parse: [] },
      }).catch(() => null));
    }
  }

  console.log(`💰 Top-5 market value recovered: manager=${userId}, player=${previous.playerName}, value=${result.submission.marketValue}, persistedToDiscord=${durable}`);
  return interaction.editReply({
    content: [
      `✅ Marktwert für **${previous.playerName}** nachträglich geladen: **${formatMarketValue(result.submission.marketValue)}**.`,
      "Deine ursprüngliche Top-5-Abgabe und ihre Uhrzeit bleiben unverändert.",
      "⚠️ Das ist der Marktwert vom **Zeitpunkt der Nachabfrage**, nicht nachweislich der historische Wert zum Abgabezeitpunkt.",
      durable
        ? (updatedOriginal ? "📝 Die ursprüngliche Discord-Abgabe wurde aktualisiert." : "📝 Eine dauerhafte Ergänzung wurde im Top-5-Kanal veröffentlicht.")
        : "⚠️ Der neue Wert ist lokal gespeichert, konnte aber nicht dauerhaft im Discord-Kanal gesichert werden. Bitte die Kanalberechtigungen prüfen.",
    ].join("\n"),
  });
}
