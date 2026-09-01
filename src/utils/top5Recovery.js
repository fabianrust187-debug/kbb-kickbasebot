import { addManager, getManagers } from "./managerStore.js";
import { restoreTop5Submissions } from "./top5Store.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";
const DEFAULT_TARGET = Number(process.env.TOP5_MANAGER_TARGET || 14);
const MAX_MESSAGES = 1000;

function isRoundBoundary(message) {
  const content = String(message?.content || "");
  return content.includes("Top-5-Abgabefrist beendet")
    || content.includes("Neue Top-5-Runde gestartet");
}

function parseSubmission(message) {
  const content = String(message?.content || "");
  const match = content.match(/Manager:\s*<@!?(\d+)>\s+hat\s+\*\*(.+?)\*\*\s+abgegeben\./s);
  if (!match) return null;

  return {
    userId: match[1],
    userTag: null,
    playerName: match[2].trim(),
    marketValue: null,
    createdAt: message.createdAt?.toISOString?.() || new Date(message.createdTimestamp || Date.now()).toISOString(),
    messageId: message.id,
  };
}

async function fetchHistory(channel, maxMessages = MAX_MESSAGES) {
  const all = [];
  let before;

  while (all.length < maxMessages) {
    const limit = Math.min(100, maxMessages - all.length);
    const batch = await channel.messages.fetch({ limit, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;

    const messages = [...batch.values()];
    all.push(...messages);
    before = messages[messages.length - 1]?.id;
    if (batch.size < limit) break;
  }

  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

export async function recoverKbbStateFromDiscord(guild, { channelId = null, target = DEFAULT_TARGET } = {}) {
  const resolvedChannelId = channelId || DEFAULT_TOP5_CHANNEL_ID;
  const channel = await guild.channels.fetch(resolvedChannelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    return { ok: false, error: `Top-5-Channel ${resolvedChannelId} nicht lesbar.` };
  }

  const history = await fetchHistory(channel);
  const botId = guild.client.user?.id;
  const botMessages = history.filter(message => message.author?.id === botId);

  const allSubmissionEntries = botMessages
    .map(parseSubmission)
    .filter(Boolean);

  let lastBoundaryIndex = -1;
  botMessages.forEach((message, index) => {
    if (isRoundBoundary(message)) lastBoundaryIndex = index;
  });

  const currentMessages = lastBoundaryIndex >= 0
    ? botMessages.slice(lastBoundaryIndex + 1)
    : botMessages;

  const currentEntries = currentMessages
    .map(parseSubmission)
    .filter(Boolean);

  const uniqueCurrent = [];
  const currentSeen = new Set();
  for (const entry of currentEntries) {
    if (currentSeen.has(entry.userId)) continue;
    currentSeen.add(entry.userId);
    uniqueCurrent.push(entry);
  }

  const restoredRound = restoreTop5Submissions(guild.id, uniqueCurrent, target);
  if (!restoredRound.ok) return restoredRound;

  const existingManagers = new Set(getManagers(guild.id).map(manager => String(manager.userId)));
  let managersRecovered = 0;

  for (const entry of allSubmissionEntries) {
    if (existingManagers.size >= target) break;
    if (existingManagers.has(entry.userId)) continue;

    const result = addManager(guild.id, { id: entry.userId, username: null }, guild.client.user);
    if (result.ok) {
      existingManagers.add(entry.userId);
      managersRecovered += 1;
    }
  }

  return {
    ok: true,
    channelId: resolvedChannelId,
    scannedMessages: history.length,
    submissionMessages: allSubmissionEntries.length,
    currentSubmissionsFound: uniqueCurrent.length,
    submissionsRestored: restoredRound.restored,
    currentSubmissionCount: restoredRound.count,
    managersRecovered,
    managerCount: getManagers(guild.id).length,
    target,
  };
}
