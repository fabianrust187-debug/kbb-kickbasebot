import crypto from "crypto";
import { buildKbbEmbed } from "./embeds.js";
import { formatTransferPrice, getLatestLeagueTransfers } from "./kickbaseFeed.js";
import { getManagers } from "./managerStore.js";
import { applyManagerAliases, normalizeManagerKey, resolveManagerAlias } from "./managerAliases.js";

const TRANSFER_CHANNEL_ID = process.env.KBB_TRANSFER_CHANNEL_ID || "1522249401735839784";
const POLL_INTERVAL_MS = Math.max(30_000, Number(process.env.KBB_TRANSFER_FEED_INTERVAL_MS || 60_000));
const INITIAL_BACKFILL = Math.max(0, Math.min(15, Number(process.env.KBB_TRANSFER_INITIAL_BACKFILL || 5)));
const HISTORY_SCAN_LIMIT = 100;
const MARKER_PREFIX = "KBBTF:";

const guildStates = new Map();
const runningGuilds = new Set();

function escapeDiscordText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`>|])/g, "\\$1");
}

function transferKey(transfer) {
  if (transfer?.activityId) return String(transfer.activityId);

  const raw = [
    transfer?.createdAt,
    transfer?.buyer,
    transfer?.seller,
    transfer?.playerId,
    transfer?.playerName,
    transfer?.price,
  ].join("|");

  return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 20);
}

function extractMarker(message) {
  for (const embed of message?.embeds || []) {
    const footer = String(embed?.footer?.text || "");
    const index = footer.indexOf(MARKER_PREFIX);
    if (index < 0) continue;
    const value = footer.slice(index + MARKER_PREFIX.length).trim().split(/\s+/)[0];
    if (value) return value;
  }
  return null;
}

async function hydrateSeenFromDiscord(channel, botUserId) {
  const seen = new Set();
  const messages = await channel.messages.fetch({ limit: HISTORY_SCAN_LIMIT }).catch(() => null);
  if (!messages) return seen;

  for (const message of messages.values()) {
    if (message.author?.id !== botUserId) continue;
    const marker = extractMarker(message);
    if (marker) seen.add(marker);
  }

  return seen;
}

async function buildDiscordManagerMap(guild) {
  const managers = getManagers(guild.id);
  const map = new Map();

  const resolved = await Promise.all(managers.map(async manager => {
    const member = await guild.members.fetch(manager.userId).catch(() => null);
    if (!member) return null;

    const names = new Set([
      manager.username,
      member.displayName,
      member.nickname,
      member.user?.username,
      member.user?.globalName,
    ].filter(Boolean));

    return { userId: manager.userId, names: [...names] };
  }));

  for (const entry of resolved.filter(Boolean)) {
    for (const name of entry.names) {
      const key = normalizeManagerKey(name);
      if (!key) continue;

      if (map.has(key) && map.get(key) !== entry.userId) {
        map.set(key, null);
      } else if (!map.has(key)) {
        map.set(key, entry.userId);
      }
    }
  }

  return applyManagerAliases(map);
}

function managerLabel(kickbaseName, discordManagerMap) {
  const safeName = escapeDiscordText(kickbaseName);
  const userId = discordManagerMap.get(normalizeManagerKey(kickbaseName))
    || resolveManagerAlias(kickbaseName);

  return {
    text: userId ? `**${safeName}** (<@${userId}>)` : `**${safeName}**`,
    userId: userId || null,
  };
}

function formatWhen(createdAt) {
  if (!createdAt) return "Zeitpunkt unbekannt";
  const timestamp = Math.floor(new Date(createdAt).getTime() / 1000);
  if (!Number.isFinite(timestamp)) return "Zeitpunkt unbekannt";
  return `<t:${timestamp}:f> • <t:${timestamp}:R>`;
}

function buildTransferPost(transfer, discordManagerMap) {
  const key = transferKey(transfer);
  const buyer = managerLabel(transfer.buyer, discordManagerMap);
  const seller = transfer.seller === "KICKBASE"
    ? null
    : managerLabel(transfer.seller, discordManagerMap);
  const player = escapeDiscordText(transfer.playerName);
  const price = formatTransferPrice(transfer.price);

  const source = transfer.seller === "KICKBASE"
    ? "vom **KICKBASE-Markt**"
    : `von ${seller.text}`;

  const embed = buildKbbEmbed({
    title: `💸 ${player}`,
    description: [
      `${buyer.text} hat **${player}** ${source} für **${price}** gekauft.`,
      "",
      formatWhen(transfer.createdAt),
    ].join("\n"),
    footer: `187 KICKBASEBANDE • ${MARKER_PREFIX}${key}`,
  });

  return {
    key,
    embed,
    mentionUserIds: [buyer.userId, seller?.userId].filter(Boolean),
  };
}

function sortOldestFirst(transfers) {
  return [...transfers].sort((a, b) => {
    const left = new Date(a.createdAt || 0).getTime();
    const right = new Date(b.createdAt || 0).getTime();
    return left - right;
  });
}

async function processGuild(guild) {
  if (runningGuilds.has(guild.id)) return;
  runningGuilds.add(guild.id);

  try {
    const channel = await guild.channels.fetch(TRANSFER_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) return;

    let state = guildStates.get(guild.id);
    if (!state) {
      state = { hydrated: false, bootstrapped: false, seen: new Set() };
      guildStates.set(guild.id, state);
    }

    if (!state.hydrated) {
      state.seen = await hydrateSeenFromDiscord(channel, guild.client.user?.id);
      state.hydrated = true;
      console.log(`💸 Transfer feed recovery ${guild.name}: ${state.seen.size} known transfer marker(s)`);
    }

    const result = await getLatestLeagueTransfers({ limit: 15 });
    if (!result.ok) {
      console.warn(`⚠️ Transfer feed poll failed for ${guild.id}: ${result.error || result.code || "unknown error"}`);
      return;
    }

    let unseen = result.transfers.filter(transfer => !state.seen.has(transferKey(transfer)));

    if (!state.bootstrapped && state.seen.size === 0 && INITIAL_BACKFILL >= 0) {
      unseen = unseen.slice(0, INITIAL_BACKFILL);
    }

    state.bootstrapped = true;
    if (!unseen.length) return;

    const discordManagerMap = await buildDiscordManagerMap(guild);

    for (const transfer of sortOldestFirst(unseen)) {
      const post = buildTransferPost(transfer, discordManagerMap);
      if (state.seen.has(post.key)) continue;

      const sent = await channel.send({
        embeds: [post.embed],
        allowedMentions: { users: post.mentionUserIds, parse: [] },
      }).catch(error => {
        console.error(`❌ Transfer post failed for ${guild.id}:`, error?.message || error);
        return null;
      });

      if (!sent) continue;
      state.seen.add(post.key);
      console.log(`✅ Transfer feed posted: ${transfer.buyer} -> ${transfer.playerName} (${post.key})`);
    }
  } finally {
    runningGuilds.delete(guild.id);
  }
}

export function startKickbaseTransferFeedScheduler(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      await processGuild(guild).catch(error => {
        console.error(`❌ Transfer feed scheduler failed for ${guild.id}:`, error?.message || error);
      });
    }
  };

  setTimeout(() => run().catch(() => null), 15_000);

  console.log(`💸 Kickbase transfer feed active: channel=${TRANSFER_CHANNEL_ID}, interval=${POLL_INTERVAL_MS}ms`);
  return setInterval(() => run().catch(() => null), POLL_INTERVAL_MS);
}
