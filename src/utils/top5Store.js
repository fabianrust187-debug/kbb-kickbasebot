import fs from "fs";
import path from "path";

const FILE = path.resolve("src/data/top5Submissions.json");

export const DEFAULT_TOP5_TARGET = 14;

function ensureFile() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}\n", "utf8");
}

function read() {
  try {
    ensureFile();
    return JSON.parse(fs.readFileSync(FILE, "utf8") || "{}");
  } catch (err) {
    console.error("❌ Failed to read top5Submissions.json:", err?.message || err);
    return {};
  }
}

function write(data) {
  try {
    ensureFile();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("❌ Failed to write top5Submissions.json:", err?.message || err);
    return false;
  }
}

function getOrCreateRound(data, guildId) {
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId].activeRound) {
    data[guildId].activeRound = {
      id: `top5-${guildId}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      completedAt: null,
      submissions: {},
    };
  }

  if (!data[guildId].activeRound.submissions) {
    data[guildId].activeRound.submissions = {};
  }

  return data[guildId].activeRound;
}

function validIso(value, fallback = new Date()) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

export function sanitizePlayerName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

export function getTop5Round(guildId) {
  if (!guildId) return null;
  const data = read();
  return data[guildId]?.activeRound || null;
}

export function getTop5Submissions(guildId) {
  const round = getTop5Round(guildId);
  return Object.values(round?.submissions || {})
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function getTop5SubmissionForUser(guildId, userId) {
  const round = getTop5Round(guildId);
  return round?.submissions?.[userId] || null;
}

export function addTop5Submission(guildId, user, playerName, marketValue = null, target = DEFAULT_TOP5_TARGET) {
  if (!guildId || !user?.id) {
    return { ok: false, error: "Missing guild or user." };
  }

  const cleanName = sanitizePlayerName(playerName);
  if (!cleanName || cleanName.length < 2) {
    return { ok: false, error: "Bitte einen gültigen Spielernamen eingeben." };
  }

  const data = read();
  const round = getOrCreateRound(data, guildId);

  if (round.submissions[user.id]) {
    return {
      ok: false,
      duplicate: true,
      submission: round.submissions[user.id],
      count: Object.keys(round.submissions).length,
      target,
    };
  }

  const submission = {
    userId: user.id,
    userTag: user.tag || user.username || null,
    playerName: cleanName,
    marketValue,
    createdAt: new Date().toISOString(),
  };

  round.submissions[user.id] = submission;

  const count = Object.keys(round.submissions).length;
  const complete = count >= target;
  if (complete && !round.completedAt) {
    round.completedAt = new Date().toISOString();
  }

  if (!write(data)) {
    return { ok: false, error: "Top-5-Abgabe konnte nicht gespeichert werden." };
  }

  return {
    ok: true,
    submission,
    submissions: Object.values(round.submissions)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    count,
    target,
    complete,
    round,
  };
}

export function restoreTop5Submissions(guildId, entries = [], target = DEFAULT_TOP5_TARGET) {
  if (!guildId || !Array.isArray(entries)) {
    return { ok: false, error: "Ungültige Wiederherstellungsdaten." };
  }

  const data = read();
  const round = getOrCreateRound(data, guildId);
  let restored = 0;

  for (const entry of entries) {
    const userId = String(entry?.userId || "").trim();
    const playerName = sanitizePlayerName(entry?.playerName);
    if (!userId || playerName.length < 2) continue;

    const createdAt = validIso(entry?.createdAt);
    const existing = round.submissions[userId];

    if (existing) {
      const existingTime = new Date(existing.createdAt || 0).getTime();
      const recoveredTime = new Date(createdAt).getTime();
      if (existingTime <= recoveredTime) continue;
    }

    round.submissions[userId] = {
      userId,
      userTag: entry?.userTag || existing?.userTag || null,
      playerName,
      marketValue: entry?.marketValue ?? existing?.marketValue ?? null,
      createdAt,
      recoveredAt: new Date().toISOString(),
    };
    restored += 1;
  }

  const submissions = Object.values(round.submissions)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  if (submissions.length) {
    const firstCreatedAt = submissions[0].createdAt;
    if (!round.createdAt || new Date(firstCreatedAt) < new Date(round.createdAt)) {
      round.createdAt = firstCreatedAt;
    }
  }

  const complete = submissions.length >= target;
  if (complete && !round.completedAt) {
    round.completedAt = submissions[submissions.length - 1]?.createdAt || new Date().toISOString();
  }

  if (!write(data)) {
    return { ok: false, error: "Wiederhergestellte Top-5-Abgaben konnten nicht gespeichert werden." };
  }

  return {
    ok: true,
    restored,
    count: submissions.length,
    target,
    complete,
    submissions,
    round,
  };
}

export function resetTop5Round(guildId, actor = null) {
  if (!guildId) return { ok: false, error: "Missing guild." };

  const data = read();
  const oldRound = data[guildId]?.activeRound || null;

  if (!data[guildId]) data[guildId] = {};
  if (!Array.isArray(data[guildId].history)) data[guildId].history = [];

  if (oldRound) {
    data[guildId].history.unshift({
      ...oldRound,
      archivedAt: new Date().toISOString(),
      archivedBy: actor?.id || null,
    });
    data[guildId].history = data[guildId].history.slice(0, 20);
  }

  data[guildId].activeRound = {
    id: `top5-${guildId}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    completedAt: null,
    submissions: {},
  };

  if (!write(data)) return { ok: false, error: "Top-5-Runde konnte nicht zurückgesetzt werden." };
  return { ok: true, archivedRound: oldRound, activeRound: data[guildId].activeRound };
}
