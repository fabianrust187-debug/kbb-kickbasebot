import { getGuildSettings, setGuildSettings } from "./guildSettings.js";
import { getManagers } from "./managerStore.js";
import { getTop5Submissions, resetTop5Round } from "./top5Store.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";
const DEFAULT_TARGET = Number(process.env.TOP5_MANAGER_TARGET || 14);
const TIME_ZONE = "Europe/Berlin";

function berlinParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    weekday: map.weekday,
    year: map.year,
    month: map.month,
    day: map.day,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function deadlineKey(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getMissingTop5Managers(guildId, target = DEFAULT_TARGET) {
  const managers = getManagers(guildId);
  const submissions = getTop5Submissions(guildId);
  const submittedIds = new Set(submissions.map(entry => String(entry.userId)));
  const missing = managers.filter(manager => !submittedIds.has(String(manager.userId)));

  return {
    managers,
    submissions,
    missing,
    target,
    rosterComplete: managers.length === target,
  };
}

export function buildMissingTop5Message(result, { automatic = false } = {}) {
  const heading = automatic
    ? "## ⏰ Top-5-Abgabefrist beendet"
    : "## 📋 Top-5-Abgabe – fehlende Manager";

  if (!result.missing.length) {
    return [
      heading,
      "",
      `✅ Alle **${result.managers.length} Manager** haben ihre Top-5-Abgabe rechtzeitig eingereicht.`,
      automatic ? "\n🔄 Die nächste Top-5-Runde wurde automatisch gestartet." : "",
    ].filter(Boolean).join("\n");
  }

  return [
    heading,
    "",
    automatic
      ? "Folgende Manager haben bis **Montag, 22:00 Uhr** keine Top-5-Abgabe eingereicht:"
      : "Folgende Manager haben aktuell noch keine Top-5-Abgabe eingereicht:",
    "",
    ...result.missing.map((manager, index) => `**${index + 1}.** <@${manager.userId}>`),
    "",
    `❌ **${result.missing.length}/${result.managers.length}** Abgaben fehlen.`,
    automatic ? "\n🔄 Die nächste Top-5-Runde wurde automatisch gestartet." : "",
  ].filter(Boolean).join("\n");
}

export async function publishMissingTop5(guild, { automatic = false, resetAfter = false } = {}) {
  const settings = getGuildSettings(guild.id);
  const target = Number(process.env.TOP5_MANAGER_TARGET || DEFAULT_TARGET);
  const result = getMissingTop5Managers(guild.id, target);

  if (!result.rosterComplete) {
    return {
      ok: false,
      error: `Managerliste unvollständig: ${result.managers.length}/${target}.`,
      result,
    };
  }

  const channelId = settings.top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return { ok: false, error: `Top-5-Channel ${channelId} nicht gefunden oder nicht beschreibbar.`, result };
  }

  const content = buildMissingTop5Message(result, { automatic });
  const message = await channel.send({
    content,
    allowedMentions: { users: result.missing.map(manager => manager.userId), parse: [] },
  }).catch(() => null);

  if (!message) return { ok: false, error: "Fristmeldung konnte nicht gesendet werden.", result };

  if (resetAfter) {
    const reset = resetTop5Round(guild.id, guild.client.user);
    if (!reset.ok) return { ok: false, error: reset.error || "Top-5-Runde konnte nicht zurückgesetzt werden.", result, message };
  }

  return { ok: true, result, message };
}

async function checkGuild(guild, now = new Date()) {
  const parts = berlinParts(now);
  if (parts.weekday !== "Mon" || parts.hour !== 22) return;

  const key = deadlineKey(parts);
  const settings = getGuildSettings(guild.id);
  if (settings.lastTop5DeadlineKey === key) return;

  const result = await publishMissingTop5(guild, { automatic: true, resetAfter: true });
  if (!result.ok) {
    console.warn(`⚠️ Top-5 deadline skipped for ${guild.id}: ${result.error}`);
    return;
  }

  setGuildSettings(guild.id, {
    lastTop5DeadlineKey: key,
    lastTop5DeadlineAt: new Date().toISOString(),
  });
  console.log(`✅ Top-5 deadline posted for ${guild.name} (${guild.id})`);
}

export function startTop5DeadlineScheduler(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      await checkGuild(guild).catch(err => {
        console.error(`❌ Top-5 deadline check failed for ${guild.id}:`, err?.message || err);
      });
    }
  };

  run().catch(() => null);
  return setInterval(() => run().catch(() => null), 60_000);
}
