import { PermissionFlagsBits } from "discord.js";
import { buildErrorEmbed } from "../utils/embeds.js";
import { getGuildSettings } from "../utils/guildSettings.js";
import { formatMarketValue } from "../utils/kickbaseApi.js";
import { fetchTop5ChannelHistory, parseTop5SubmissionMessage } from "../utils/top5Recovery.js";
import { getTop5SubmissionForUser, getTop5Submissions } from "../utils/top5Store.js";
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

async function saveRecoveryToDiscord(interaction, userId, previous, updated, channel, messages) {
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    return { durable: false, updatedOriginal: false };
  }

  const history = messages || await fetchTop5ChannelHistory(channel, 500).catch(() => []);
  const original = originalSubmissionMessage(history, interaction.client.user.id, userId);
  const content = `${formatTop5SubmissionLine(userId, updated)} • 💰 *Marktwert nachträglich ermittelt*`;

  if (original?.edit) {
    const changed = await original.edit({ content, allowedMentions: { parse: [] } })
      .then(() => true).catch(() => false);
    if (changed) return { durable: true, updatedOriginal: true };
  }

  // Preserve original submission timestamp when a new fallback post is needed.
  const timestamp = Math.floor(new Date(previous.createdAt).getTime() / 1000);
  const fallback = await channel.send({
    content: `${content} • ursprüngliche Abgabe: <t:${timestamp}:f>`,
    allowedMentions: { parse: [] },
  }).catch(() => null);
  return { durable: !!fallback, updatedOriginal: false };
}

async function retryAllMissingMarketValues(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.editReply({ content: "❌ Nur die Ligaleitung darf alle fehlenden Marktwerte auf einmal nachladen." });
  }

  const missing = getTop5Submissions(interaction.guildId)
    .filter(entry => entry.marketValue === null || entry.marketValue === undefined);
  if (!missing.length) {
    return interaction.editReply({ content: "✅ In der aktuellen Top-5-Runde fehlen keine Marktwerte." });
  }

  await interaction.editReply({
    content: `🔄 Ich prüfe ${missing.length} fehlende Marktwerte nacheinander. Die ursprünglichen Abgaben bleiben erhalten.`,
  });

  const channel = await interaction.guild.channels.fetch(top5ChannelId(interaction.guildId)).catch(() => null);
  const history = channel?.messages?.fetch
    ? await fetchTop5ChannelHistory(channel, 500).catch(() => [])
    : [];

  const recovered = [];
  const failed = [];
  let savedMessages = 0;
  for (const [index, entry] of missing.entries()) {
    try {
      const previous = getTop5SubmissionForUser(interaction.guildId, entry.userId);
      if (!previous || previous.marketValue !== null && previous.marketValue !== undefined) continue;

      const result = await retryMissingTop5MarketValue(interaction.guildId, entry.userId);
      if (!result.ok) {
        failed.push(`• <@${entry.userId}> — **${entry.playerName}**: ${result.error || result.code || "API nicht erreichbar"}`);
      } else {
        const persistence = await saveRecoveryToDiscord(
          interaction, entry.userId, previous, result.submission, channel, history,
        );
        if (persistence.durable) savedMessages++;
        recovered.push(`• <@${entry.userId}> — **${entry.playerName}**: **${formatMarketValue(result.submission.marketValue)}**`);
      }
    } catch (error) {
      console.error(`❌ Top-5 MW bulk retry failed for ${entry.playerName}:`, error?.message || error);
      failed.push(`• <@${entry.userId}> — **${entry.playerName}**: interner Fehler`);
    }

    // Space out API queries to reduce the risk of rate-limiting.
    if (index < missing.length - 1) await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const lines = [
    "## 💰 Top-5-Marktwerte nachgeladen",
    `**Abgaben geprüft:** ${missing.length}`,
    `**Erfolgreich:** ${recovered.length}`,
    `**Noch fehlend:** ${failed.length}`,
    "",
    ...(recovered.length ? ["**✅ Nachgetragen:**", ...recovered, ""] : []),
    ...(failed.length ? ["**⚠️ Noch offen:**", ...failed, ""] : []),
    "Die ursprünglichen Spieler und Abgabezeiten bleiben unverändert.",
    "⚠️ Nachgeladene Werte entsprechen dem Zeitpunkt der erneuten Abfrage.",
    savedMessages < recovered.length
      ? `⚠️ ${recovered.length - savedMessages} Aktualisierung(en) wurden nicht im Discord-Kanal gesichert. Bitte Kanalberechtigungen prüfen.`
      : "",
  ];
  return interaction.editReply({
    content: lines.filter(Boolean).join("\n").slice(0, 1950),
    allowedMentions: { parse: [] },
  });
}

export async function runTop5MarketValueRetry(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  if (!interaction.guild) {
    return interaction.editReply({ embeds: [buildErrorEmbed("Nur auf dem KBB-Server nutzbar.")] });
  }

  const all = interaction.options.getBoolean("alle") === true;
  if (all) {
    if (interaction.options.getUser("manager")) {
      return interaction.editReply({ content: "❌ Bitte entweder `alle:true` oder einen einzelnen Manager auswählen." });
    }
    return retryAllMissingMarketValues(interaction);
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

  const channel = await interaction.guild.channels.fetch(top5ChannelId(interaction.guildId)).catch(() => null);
  const persistence = await saveRecoveryToDiscord(interaction, userId, previous, result.submission, channel);
  console.log(`💰 Top-5 market value recovered: manager=${userId}, player=${previous.playerName}, value=${result.submission.marketValue}, persistedToDiscord=${persistence.durable}`);

  return interaction.editReply({
    content: [
      `✅ Marktwert für **${previous.playerName}** nachträglich geladen: **${formatMarketValue(result.submission.marketValue)}**.`,
      "Deine ursprüngliche Top-5-Abgabe und ihre Uhrzeit bleiben unverändert.",
      "⚠️ Das ist der Marktwert vom **Zeitpunkt der Nachabfrage**, nicht nachweislich der historische Wert zum Abgabezeitpunkt.",
      persistence.durable
        ? (persistence.updatedOriginal ? "📝 Die ursprüngliche Discord-Abgabe wurde aktualisiert." : "📝 Eine dauerhafte Ergänzung wurde im Top-5-Kanal veröffentlicht.")
        : "⚠️ Der neue Wert ist lokal gespeichert, konnte aber nicht dauerhaft im Discord-Kanal gesichert werden. Bitte die Kanalberechtigungen prüfen.",
    ].join("\n"),
  });
}
