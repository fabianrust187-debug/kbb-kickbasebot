import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getTop5Round } from "./top5Store.js";

export const TOP5_BUTTON_PREFIX = "kbb_top5_open:";

export function buildTop5ButtonRow(roundId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TOP5_BUTTON_PREFIX}${roundId}`)
      .setLabel("Spieler abgeben")
      .setEmoji("🎯")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

function getButtonCustomIds(message) {
  return (message?.components || [])
    .flatMap(row => row.components || [])
    .map(component => component.customId)
    .filter(Boolean);
}

export async function ensureTop5SubmitButton(guild, { channelId } = {}) {
  const round = getTop5Round(guild.id);
  if (!round?.id) return { ok: false, error: "Keine aktive Top-5-Runde." };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    return { ok: false, error: "Top-5-Channel nicht lesbar." };
  }

  const expectedId = `${TOP5_BUTTON_PREFIX}${round.id}`;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return { ok: false, error: "Top-5-Nachrichten konnten nicht geladen werden." };

  let current = null;
  const stale = [];

  for (const message of recent.values()) {
    if (message.author?.id !== guild.client.user?.id) continue;
    const customIds = getButtonCustomIds(message);
    if (customIds.includes(expectedId)) current = message;
    if (customIds.some(id => id.startsWith(TOP5_BUTTON_PREFIX) && id !== expectedId)) stale.push(message);
  }

  for (const message of stale) {
    const oldId = getButtonCustomIds(message).find(id => id.startsWith(TOP5_BUTTON_PREFIX));
    if (!oldId) continue;
    const oldRoundId = oldId.slice(TOP5_BUTTON_PREFIX.length);
    await message.edit({ components: [buildTop5ButtonRow(oldRoundId, true)] }).catch(() => null);
  }

  if (current) return { ok: true, message: current, created: false };

  const message = await channel.send({
    content: [
      "## 🎯 Top-5-Spieler abgeben",
      "Noch keinen Spieler für diese Runde abgegeben? Drücke einfach auf den Button.",
      "**Frist: Dienstag, 22:00 Uhr**",
    ].join("\n"),
    components: [buildTop5ButtonRow(round.id)],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!message) return { ok: false, error: "Top-5-Button konnte nicht gepostet werden." };
  return { ok: true, message, created: true };
}
