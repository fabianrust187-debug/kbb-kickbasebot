import { getGuildSettings } from "./guildSettings.js";
import { fetchTop5ChannelHistory, parseTop5SubmissionMessage } from "./top5Recovery.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";

export async function getDurableTop5History(guild, { userId = null, limit = 20 } = {}) {
  const settings = getGuildSettings(guild.id);
  const channelId = settings.top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    return { ok: false, error: `Top-5-Channel ${channelId} nicht lesbar.` };
  }

  const messages = await fetchTop5ChannelHistory(channel, 1000);
  const botId = guild.client.user?.id;
  let entries = messages
    .filter(message => message.author?.id === botId)
    .map(parseTop5SubmissionMessage)
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  if (userId) entries = entries.filter(entry => String(entry.userId) === String(userId));
  entries = entries.slice(0, Math.min(50, Math.max(1, Number(limit) || 20)));

  return {
    ok: true,
    channelId,
    entries,
  };
}
