import { getGuildSettings, setGuildSettings } from "./guildSettings.js";
import { getManagers } from "./managerStore.js";
import { recoverKbbStateFromDiscord } from "./top5Recovery.js";
import { getTop5Round, getTop5Submissions, resetTop5Round } from "./top5Store.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";
const DEFAULT_TARGET = Number(process.env.TOP5_MANAGER_TARGET || 14);
const TIME_ZONE = "Europe/Berlin";
const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

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
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function localDateKey(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localMinuteKey(parts) {
  return `${localDateKey(parts)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function addLocalDays(parts, days) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

export function getRoundDeadline(guildId) {
  const round = getTop5Round(guildId);
  if (!round?.createdAt) return null;

  const created = berlinParts(new Date(round.createdAt));
  const weekday = WEEKDAY_INDEX[created.weekday] ?? 0;
  let daysUntilMonday = (7 - weekday) % 7;

  // Eine Runde, die am Montag ab 22:00 Uhr startet, gehört bereits zur Folgewoche.
  if (daysUntilMonday === 0 && created.hour >= 22) {
    daysUntilMonday = 7;
  }

  const date = addLocalDays(created, daysUntilMonday);
  const deadlineParts = { ...date, weekday: "Mon", hour: 22, minute: 0 };

  return {
    ...deadlineParts,
    key: localMinuteKey(deadlineParts),
    dateKey: localDateKey(deadlineParts),
    label: `${String(deadlineParts.day).padStart(2, "0")}.${String(deadlineParts.month).padStart(2, "0")}.${deadlineParts.year} um 22:00 Uhr`,
  };
}

export function getMissingTop5Managers(guildId, target = DEFAULT_TARGET, now = new Date()) {
  const managers = getManagers(guildId);
  const submissions = getTop5Submissions(guildId);
  const deadline = getRoundDeadline(guildId);
  const nowKey = localMinuteKey(berlinParts(now));
  const deadlinePassed = !!deadline && nowKey >= deadline.key;
  const byUser = new Map(submissions.map(entry => [String(entry.userId), entry]));

  const missing = [];
  const late = [];
  const timely = [];

  for (const manager of managers) {
    const submission = byUser.get(String(manager.userId));
    if (!submission) {
      missing.push(manager);
      continue;
    }

    if (deadlinePassed && deadline) {
      const submittedKey = localMinuteKey(berlinParts(new Date(submission.createdAt)));
      if (submittedKey > deadline.key) {
        late.push({ ...manager, submission, submittedKey });
        continue;
      }
    }

    timely.push({ ...manager, submission });
  }

  const failed = [...missing, ...late];

  return {
    managers,
    submissions,
    missing,
    late,
    timely,
    failed,
    deadline,
    deadlinePassed,
    target,
    rosterComplete: managers.length === target,
  };
}

function formatSubmissionTime(createdAt) {
  const parts = berlinParts(new Date(createdAt));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} Uhr`;
}

export function buildMissingTop5Message(result, { automatic = false } = {}) {
  const heading = automatic
    ? "## ⏰ Top-5-Abgabefrist beendet"
    : "## 📋 Top-5-Fristprüfung";

  if (!result.failed.length) {
    return [
      heading,
      "",
      result.deadlinePassed && result.deadline
        ? `✅ Alle **${result.managers.length} Manager** haben bis **${result.deadline.label}** rechtzeitig abgegeben.`
        : `✅ Aktuell haben alle **${result.managers.length} Manager** ihre Top-5-Abgabe eingereicht.`,
      automatic ? "\n🔄 Die nächste Top-5-Runde wurde automatisch gestartet." : "",
    ].filter(Boolean).join("\n");
  }

  const lines = [heading, ""];

  if (result.deadlinePassed && result.deadline) {
    lines.push(`Folgende Manager haben bis **${result.deadline.label}** nicht rechtzeitig abgegeben:`, "");
  } else {
    lines.push("Folgende Manager haben aktuell noch keine Top-5-Abgabe eingereicht:", "");
  }

  let index = 1;
  for (const manager of result.missing) {
    lines.push(`**${index++}.** <@${manager.userId}> — **keine Abgabe**`);
  }
  for (const manager of result.late) {
    lines.push(`**${index++}.** <@${manager.userId}> — **zu spät** (${formatSubmissionTime(manager.submission.createdAt)})`);
  }

  lines.push("", `❌ **${result.failed.length}/${result.managers.length} Manager** haben nicht rechtzeitig abgegeben.`);
  if (automatic) lines.push("", "🔄 Die nächste Top-5-Runde wurde automatisch gestartet.");

  return lines.join("\n");
}

async function postRoundStartMarker(channel) {
  return channel.send({
    content: "🔄 **Neue Top-5-Runde gestartet.**\nDie nächste Top-5-Abgabe kann ab sofort eingereicht werden.",
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

export async function publishMissingTop5(guild, { automatic = false, resetAfter = false, now = new Date() } = {}) {
  const settings = getGuildSettings(guild.id);
  const target = Number(process.env.TOP5_MANAGER_TARGET || DEFAULT_TARGET);
  const result = getMissingTop5Managers(guild.id, target, now);

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
    allowedMentions: { users: result.failed.map(manager => manager.userId), parse: [] },
  }).catch(() => null);

  if (!message) return { ok: false, error: "Fristmeldung konnte nicht gesendet werden.", result };

  if (resetAfter) {
    const reset = resetTop5Round(guild.id, guild.client.user);
    if (!reset.ok) return { ok: false, error: reset.error || "Top-5-Runde konnte nicht zurückgesetzt werden.", result, message };
    await postRoundStartMarker(channel);
  }

  return { ok: true, result, message };
}

async function recoverGuild(guild) {
  const settings = getGuildSettings(guild.id);
  const channelId = settings.top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
  const recovery = await recoverKbbStateFromDiscord(guild, {
    channelId,
    target: Number(process.env.TOP5_MANAGER_TARGET || DEFAULT_TARGET),
  });

  if (recovery.ok) {
    console.log(`♻️ KBB recovery ${guild.name}: ${recovery.currentSubmissionCount} Abgaben, ${recovery.managerCount}/${recovery.target} Manager`);
  } else {
    console.warn(`⚠️ KBB recovery skipped for ${guild.id}: ${recovery.error}`);
  }
}

async function checkGuild(guild, now = new Date()) {
  const parts = berlinParts(now);
  const result = getMissingTop5Managers(guild.id, Number(process.env.TOP5_MANAGER_TARGET || DEFAULT_TARGET), now);
  const deadline = result.deadline;

  if (!deadline || parts.weekday !== "Mon" || parts.hour < 22) return;
  if (localDateKey(parts) !== deadline.dateKey) return;

  const settings = getGuildSettings(guild.id);
  if (settings.lastTop5DeadlineKey === deadline.dateKey) return;

  const published = await publishMissingTop5(guild, { automatic: true, resetAfter: true, now });
  if (!published.ok) {
    console.warn(`⚠️ Top-5 deadline skipped for ${guild.id}: ${published.error}`);
    return;
  }

  setGuildSettings(guild.id, {
    lastTop5DeadlineKey: deadline.dateKey,
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

  const initialize = async () => {
    for (const guild of client.guilds.cache.values()) {
      await recoverGuild(guild).catch(err => {
        console.error(`❌ KBB recovery failed for ${guild.id}:`, err?.message || err);
      });
    }
    await run();
  };

  initialize().catch(() => null);
  return setInterval(() => run().catch(() => null), 60_000);
}
