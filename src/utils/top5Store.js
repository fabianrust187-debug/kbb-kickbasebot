import { getManagers } from "./managerStore.js";
import { ACTIVE_MANAGER_TARGET } from "./activeManagerRoster.js";
import fs from "fs";
import path from "path";

const FILE = path.resolve("src/data/top5Submissions.json");

export const DEFAULT_TOP5_TARGET = ACTIVE_MANAGER_TARGET;

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
      closedAt: null,
      closedBy: null,
      closeReason: null,
      submissions: {},
      exemptions: {},
    };
  }

  if (!data[guildId].activeRound.submissions) {
    data[guildId].activeRound.submissions = {};
  }
  if (!data[guildId].activeRound.exemptions) {
    data[guildId].activeRound.exemptions = {};
  }

  return data[guildId].activeRound;
}

function validIso(value, fallback = new Date()) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function validMarketValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  }
  return null;
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
  // Keep prior departures in history without counting them as active.
  const activeIds = new Set(getManagers(guildId).map(manager => String(manager.userId)));
  return Object.values(round?.submissions || {})
    .filter(entry => activeIds.size === 0 || activeIds.has(String(entry.userId)))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function getTop5SubmissionForUser(guildId, userId) {
  const round = getTop5Round(guildId);
  return round?.submissions?.[userId] || null;
}


function activeCompletionCounts(guildId, round) {
  const managers = getManagers(guildId);
  const activeIds = new Set(managers.map(manager => String(manager.userId)));
  const submittedIds = new Set(
    Object.keys(round?.submissions || {}).filter(id => activeIds.has(String(id))),
  );
  const exemptIds = Object.keys(round?.exemptions || {})
    .filter(id => activeIds.has(String(id)) && !submittedIds.has(String(id)));
  return {
    managers: managers.length,
    submitted: submittedIds.size,
    exempted: exemptIds.length,
    completed: submittedIds.size + exemptIds.length,
  };
}

export function getTop5Exemptions(guildId) {
  const round = getTop5Round(guildId);
  const activeIds = new Set(getManagers(guildId).map(manager => String(manager.userId)));
  return Object.values(round?.exemptions || {})
    .filter(entry => activeIds.has(String(entry.userId)) && !round?.submissions?.[entry.userId])
    .sort((a, b) => String(a.exemptedAt).localeCompare(String(b.exemptedAt)));
}

export function getTop5ExemptionForUser(guildId, userId) {
  return getTop5Round(guildId)?.exemptions?.[userId] || null;
}

// Exemptions are not fake submissions. They apply only to the currently
// active round and are archived with it on reset.
export function exemptTop5Manager(guildId, userId, actor = null, reason = "Am Spieltag im Minus") {
  if (!guildId || !userId) return { ok: false, error: "Guild oder Manager fehlt." };
  const managers = getManagers(guildId);
  if (!managers.some(manager => String(manager.userId) === String(userId))) {
    return { ok: false, code: "NOT_A_MANAGER", error: "Dieser Nutzer steht nicht in der aktiven Managerliste." };
  }

  const data = read();
  const round = data[guildId]?.activeRound;
  if (!round) return { ok: false, error: "Keine aktive Top-5-Runde gefunden." };
  if (round.closedAt) return { ok: false, code: "ROUND_CLOSED", error: "Diese Runde ist bereits geschlossen." };
  if (round.submissions?.[userId]) {
    return { ok: false, code: "ALREADY_SUBMITTED", error: "Dieser Manager hat bereits einen Spieler abgegeben." };
  }
  if (round.exemptions?.[userId]) {
    return { ok: false, code: "ALREADY_EXEMPT", error: "Dieser Manager ist bereits für diese Runde freigestellt." };
  }

  const exemption = {
    userId: String(userId),
    reason: String(reason || "Am Spieltag im Minus").trim().slice(0, 150),
    exemptedAt: new Date().toISOString(),
    exemptedBy: actor?.id || null,
  };
  if (!round.exemptions) round.exemptions = {};
  round.exemptions[userId] = exemption;
  const counts = activeCompletionCounts(guildId, round);
  if (counts.managers === DEFAULT_TOP5_TARGET && counts.completed === DEFAULT_TOP5_TARGET) {
    round.completedAt = round.completedAt || exemption.exemptedAt;
  }
  if (!write(data)) return { ok: false, error: "Top-5-Freistellung konnte nicht gespeichert werden." };
  return { ok: true, exemption, round, ...counts };
}

// Used to roll back a freistellung if the durable Discord notice could not be sent.
export function revokeTop5Exemption(guildId, userId) {
  const data = read();
  const round = data[guildId]?.activeRound;
  if (!round || round.closedAt || !round.exemptions?.[userId]) return { ok: false };
  delete round.exemptions[userId];
  const counts = activeCompletionCounts(guildId, round);
  if (counts.completed < DEFAULT_TOP5_TARGET) round.completedAt = null;
  return { ok: write(data) };
}

// Reconstruct the current round's exemptions from the bot's Discord messages
// after a hosting redeploy; duplicates and submissions are never overwritten.
export function restoreTop5Exemptions(guildId, entries = []) {
  if (!guildId || !Array.isArray(entries)) return { ok: false, error: "Ungültige Freistellungen." };
  const data = read();
  const round = getOrCreateRound(data, guildId);
  let restored = 0;
  for (const entry of entries) {
    const userId = String(entry?.userId || "").trim();
    if (!/^\\d{16,22}$/.test(userId) || round.submissions?.[userId] || round.exemptions?.[userId]) continue;
    round.exemptions[userId] = {
      userId,
      reason: String(entry.reason || "Am Spieltag im Minus").trim().slice(0, 150),
      exemptedAt: validIso(entry.exemptedAt),
      exemptedBy: entry.exemptedBy || null,
    };
    restored++;
  }
  const counts = activeCompletionCounts(guildId, round);
  if (counts.managers === DEFAULT_TOP5_TARGET && counts.completed === DEFAULT_TOP5_TARGET) {
    round.completedAt = round.completedAt || new Date().toISOString();
  }
  if (!write(data)) return { ok: false, error: "Freistellungen konnten nicht wiederhergestellt werden." };
  return { ok: true, restored, ...counts };
}

export function getTop5History(guildId, limit = 20) {
  if (!guildId) return [];
  const data = read();
  const guild = data[guildId] || {};
  const rounds = [guild.activeRound, ...(Array.isArray(guild.history) ? guild.history : [])].filter(Boolean);
  const entries = [];

  for (const round of rounds) {
    for (const submission of Object.values(round.submissions || {})) {
      entries.push({
        ...submission,
        roundId: round.id || null,
        roundCreatedAt: round.createdAt || null,
        archivedAt: round.archivedAt || null,
      });
    }
  }

  return entries
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.max(1, Number(limit) || 20));
}

export function addTop5Submission(
  guildId,
  user,
  playerName,
  marketValue = null,
  target = DEFAULT_TOP5_TARGET,
  metadata = {},
) {
  if (!guildId || !user?.id) {
    return { ok: false, error: "Missing guild or user." };
  }

  const cleanName = sanitizePlayerName(playerName);
  if (!cleanName || cleanName.length < 2) {
    return { ok: false, error: "Bitte einen gültigen Spielernamen eingeben." };
  }

  const data = read();
  const round = getOrCreateRound(data, guildId);

  if (round.closedAt) {
    return {
      ok: false,
      code: "ROUND_CLOSED",
      error: "Diese Top-5-Runde ist bereits abgeschlossen.",
      round,
    };
  }

  if (round.submissions[user.id]) {
    return {
      ok: false,
      duplicate: true,
      submission: round.submissions[user.id],
      count: Object.keys(round.submissions).length,
      target,
    };
  }
  if (round.exemptions?.[user.id]) {
    return { ok: false, code: "EXEMPT", error: "Du bist für diese Top-5-Runde von der Abgabe befreit." };
  }

  const submission = {
    userId: user.id,
    userTag: user.tag || user.username || null,
    playerName: cleanName,
    submittedPlayerName: sanitizePlayerName(metadata.submittedPlayerName || cleanName),
    kickbasePlayerId: metadata.playerId ? String(metadata.playerId) : null,
    marketValue: validMarketValue(marketValue),
    marketValueFetchedAt: metadata.fetchedAt ? validIso(metadata.fetchedAt) : null,
    marketValueSource: metadata.source || null,
    kickbaseCompetitionId: metadata.competitionId ? String(metadata.competitionId) : null,
    kickbaseLeagueId: metadata.leagueId ? String(metadata.leagueId) : null,
    createdAt: new Date().toISOString(),
  };

  round.submissions[user.id] = submission;

  const activeIds = new Set(getManagers(guildId).map(manager => String(manager.userId)));
  const activeSubmissions = Object.values(round.submissions)
    .filter(entry => activeIds.size === 0 || activeIds.has(String(entry.userId)));
  const count = activeSubmissions.length;
  const counts = activeCompletionCounts(guildId, round);
  const complete = counts.managers === target && counts.completed === target;
  if (complete && !round.completedAt) {
    round.completedAt = new Date().toISOString();
  }

  if (!write(data)) {
    return { ok: false, error: "Top-5-Abgabe konnte nicht gespeichert werden." };
  }

  return {
    ok: true,
    submission,
    submissions: activeSubmissions.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
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
      submittedPlayerName: sanitizePlayerName(entry?.submittedPlayerName || playerName),
      kickbasePlayerId: entry?.kickbasePlayerId ? String(entry.kickbasePlayerId) : existing?.kickbasePlayerId || null,
      marketValue: validMarketValue(entry?.marketValue ?? existing?.marketValue),
      marketValueFetchedAt: entry?.marketValueFetchedAt
        ? validIso(entry.marketValueFetchedAt)
        : existing?.marketValueFetchedAt || null,
      marketValueSource: entry?.marketValueSource || existing?.marketValueSource || null,
      kickbaseCompetitionId: entry?.kickbaseCompetitionId || existing?.kickbaseCompetitionId || null,
      kickbaseLeagueId: entry?.kickbaseLeagueId || existing?.kickbaseLeagueId || null,
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

  const activeIds = new Set(getManagers(guildId).map(manager => String(manager.userId)));
  const activeCount = submissions.filter(entry => activeIds.size === 0 || activeIds.has(String(entry.userId))).length;
  const counts = activeCompletionCounts(guildId, round);
  const complete = counts.managers === target && counts.completed === target;
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

export function correctTop5Submission(
  guildId,
  userId,
  playerName,
  marketValue = null,
  metadata = {},
  actor = null,
) {
  if (!guildId || !userId) {
    return { ok: false, error: "Missing guild or user." };
  }

  const cleanName = sanitizePlayerName(playerName);
  if (!cleanName || cleanName.length < 2) {
    return { ok: false, error: "Bitte einen gültigen Spielernamen eingeben." };
  }

  const data = read();
  const round = data[guildId]?.activeRound || null;
  if (!round) return { ok: false, error: "Keine aktive Top-5-Runde gefunden." };

  const existing = round.submissions?.[userId] || null;
  if (!existing) {
    return { ok: false, code: "NOT_FOUND", error: "Für diesen Manager gibt es in der aktuellen Runde keine Abgabe." };
  }

  const correctedAt = new Date().toISOString();
  const correction = {
    fromPlayerName: existing.playerName,
    toPlayerName: cleanName,
    correctedAt,
    correctedBy: actor?.id || null,
  };

  round.submissions[userId] = {
    ...existing,
    playerName: cleanName,
    submittedPlayerName: sanitizePlayerName(metadata.submittedPlayerName || cleanName),
    kickbasePlayerId: metadata.playerId ? String(metadata.playerId) : null,
    marketValue: validMarketValue(marketValue),
    marketValueFetchedAt: metadata.fetchedAt ? validIso(metadata.fetchedAt) : null,
    marketValueSource: metadata.source || null,
    kickbaseCompetitionId: metadata.competitionId ? String(metadata.competitionId) : null,
    kickbaseLeagueId: metadata.leagueId ? String(metadata.leagueId) : null,
    correctedAt,
    correctedBy: actor?.id || null,
    corrections: [...(Array.isArray(existing.corrections) ? existing.corrections : []), correction].slice(-10),
  };

  if (!write(data)) {
    return { ok: false, error: "Top-5-Abgabe konnte nicht korrigiert werden." };
  }

  return {
    ok: true,
    previousSubmission: existing,
    submission: round.submissions[userId],
    round,
  };
}

/**
 * Enrich an existing submission with an API value without changing the
 * submitted player, submission timestamp, late status or participant count.
 * Never erase a valid value if a later API refresh fails.
 */
export function attachTop5MarketValue(guildId, userId, lookup) {
  if (!guildId || !userId || !lookup?.ok) {
    return { ok: false, error: "Kein gültiger Kickbase-Marktwert abrufbar." };
  }
  const marketValue = validMarketValue(lookup.marketValue);
  if (marketValue === null) {
    return { ok: false, error: "Kickbase hat keinen numerischen Marktwert geliefert." };
  }

  const data = read();
  const round = data[guildId]?.activeRound;
  const existing = round?.submissions?.[userId];
  if (!existing) {
    return { ok: false, error: "Diese Top-5-Abgabe wurde nicht gefunden." };
  }
  if (existing.marketValue !== null && existing.marketValue !== undefined) {
    return { ok: false, code: "ALREADY_SET", error: "Der Marktwert dieser Abgabe ist bereits gespeichert.", submission: existing };
  }

  const updated = {
    ...existing,
    kickbasePlayerId: lookup.playerId ? String(lookup.playerId) : existing.kickbasePlayerId,
    marketValue,
    marketValueFetchedAt: validIso(lookup.fetchedAt),
    marketValueSource: `${lookup.source || "kickbase-v4"}-recovered`,
    marketValueRecoveredAt: new Date().toISOString(),
    kickbaseCompetitionId: lookup.competitionId ? String(lookup.competitionId) : existing.kickbaseCompetitionId,
    kickbaseLeagueId: lookup.leagueId ? String(lookup.leagueId) : existing.kickbaseLeagueId,
  };
  round.submissions[userId] = updated;
  if (!write(data)) return { ok: false, error: "Marktwert konnte nicht gespeichert werden." };
  return { ok: true, previousSubmission: existing, submission: updated };
}

export function closeTop5Round(guildId, actor = null, reason = "complete") {
  if (!guildId) return { ok: false, error: "Missing guild." };

  const data = read();
  const round = data[guildId]?.activeRound || null;
  if (!round) return { ok: false, error: "Keine aktive Top-5-Runde gefunden." };

  if (round.closedAt) {
    return { ok: true, alreadyClosed: true, round };
  }

  const now = new Date().toISOString();
  round.completedAt = round.completedAt || now;
  round.closedAt = now;
  round.closedBy = actor?.id || null;
  round.closeReason = reason || "complete";

  if (!write(data)) return { ok: false, error: "Top-5-Runde konnte nicht geschlossen werden." };
  return { ok: true, alreadyClosed: false, round };
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
    closedAt: null,
    closedBy: null,
    closeReason: null,
    submissions: {},
    exemptions: {},
  };

  if (!write(data)) return { ok: false, error: "Top-5-Runde konnte nicht zurückgesetzt werden." };
  return { ok: true, archivedRound: oldRound, activeRound: data[guildId].activeRound };
}
