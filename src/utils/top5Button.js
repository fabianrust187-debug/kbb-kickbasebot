import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getTop5Round } from "./top5Store.js";

export const TOP5_BUTTON_PREFIX = "kbb_top5_open:";

export function buildTop5ButtonRow(roundId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TOP5_BUTTON_PREFIX}${roundId}`)
      .setLabel("Spieler abgeben")
      .setEmoji({ name: "🎯" })
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

function getButtonComponents(message) {
  return (message?.components || []).flatMap(row => row.components || []);
}

function hasTop5Button(message) {
  return getButtonComponents(message)
    .some(component => component.customId?.startsWith(TOP5_BUTTON_PREFIX));
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

  const currentMessages = [];
  const obsoleteMessages = [];

  for (const message of recent.values()) {
    if (message.author?.id !== guild.client.user?.id || !hasTop5Button(message)) continue;

    const isCurrent = getButtonComponents(message)
      .some(component => component.customId === expectedId);

    if (isCurrent) currentMessages.push(message);
    else obsoleteMessages.push(message);
  }

  // Keep exactly one button message for the active round. If rapid deploys/tests
  // created duplicates, keep the newest one and remove the rest.
  currentMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  const current = currentMessages.shift() || null;
  const duplicates = currentMessages;

  const cleanup = [...obsoleteMessages, ...duplicates];
  for (const message of cleanup) {
    await message.delete().catch(() => null);
  }

  if (current) {
    return {
      ok: true,
      message: current,
      created: false,
      cleaned: cleanup.length,
    };
  }

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
  return {
    ok: true,
    message,
    created: true,
    cleaned: cleanup.length,
  };
}
