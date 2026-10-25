import { formatMarketValue, resolveKickbasePlayerMarketValue } from "./kickbaseApi.js";
import { isTop5DeadlinePassed } from "./top5Deadline.js";
import {
  addTop5Submission,
  attachTop5MarketValue,
  correctTop5Submission,
  getTop5Round,
  getTop5SubmissionForUser,
  sanitizePlayerName,
} from "./top5Store.js";

export async function submitTop5WithMarketValue(guildId, user, inputName, target) {
  const existing = getTop5SubmissionForUser(guildId, user?.id);
  if (existing) {
    return {
      ok: false,
      duplicate: true,
      submission: existing,
    };
  }

  const round = getTop5Round(guildId);
  if (round?.closedAt) {
    return {
      ok: false,
      code: "ROUND_CLOSED",
      error: "Diese Top-5-Runde ist bereits endgültig abgeschlossen. Die nächste Runde startet regulär Freitag um 20:00 Uhr.",
    };
  }

  // Missing managers may still catch up after Tuesday 22:00. Their submission
  // remains late for the deadline evaluation, so an already imposed penalty is
  // not undone by submitting afterwards.
  const late = isTop5DeadlinePassed(guildId);

  const submittedPlayerName = sanitizePlayerName(inputName);
  const lookup = await resolveKickbasePlayerMarketValue(submittedPlayerName);
  if (!lookup.ok) console.warn(`⚠️ Top-5 Marktwert nicht verfügbar für ${submittedPlayerName}: ${lookup.code || "API_ERROR"} / ${lookup.error || "unbekannt"}`);

  if (!lookup.ok && ["AMBIGUOUS", "NOT_FOUND"].includes(lookup.code)) {
    return {
      ok: false,
      lookupError: true,
      lookup,
      error: lookup.error,
    };
  }

  const resolvedName = lookup.ok ? lookup.playerName : submittedPlayerName;
  const marketValue = lookup.ok ? lookup.marketValue : null;
  const metadata = lookup.ok
    ? {
        submittedPlayerName,
        playerId: lookup.playerId,
        fetchedAt: lookup.fetchedAt,
        source: lookup.source,
        competitionId: lookup.competitionId,
        leagueId: lookup.leagueId,
        late,
      }
    : {
        submittedPlayerName,
        source: lookup.code === "NOT_CONFIGURED" ? "not-configured" : "api-unavailable",
        late,
      };

  const result = addTop5Submission(
    guildId,
    user,
    resolvedName,
    marketValue,
    target,
    metadata,
  );

  return {
    ...result,
    late,
    lookup,
    marketValueAvailable: result.ok && result.submission.marketValue !== null,
  };
}

export async function correctTop5WithMarketValue(guildId, user, inputName, actor) {
  const existing = getTop5SubmissionForUser(guildId, user?.id);
  if (!existing) {
    return {
      ok: false,
      code: "NOT_FOUND",
      error: "Für diesen Manager gibt es in der aktuellen Runde keine Abgabe.",
    };
  }

  const submittedPlayerName = sanitizePlayerName(inputName);
  const lookup = await resolveKickbasePlayerMarketValue(submittedPlayerName);

  if (!lookup.ok && ["AMBIGUOUS", "NOT_FOUND"].includes(lookup.code)) {
    return {
      ok: false,
      lookupError: true,
      lookup,
      error: lookup.error,
    };
  }

  const resolvedName = lookup.ok ? lookup.playerName : submittedPlayerName;
  const marketValue = lookup.ok ? lookup.marketValue : null;
  const metadata = lookup.ok
    ? {
        submittedPlayerName,
        playerId: lookup.playerId,
        fetchedAt: lookup.fetchedAt,
        source: `${lookup.source || "kickbase"}-admin-correction`,
        competitionId: lookup.competitionId,
        leagueId: lookup.leagueId,
      }
    : {
        submittedPlayerName,
        source: lookup.code === "NOT_CONFIGURED"
          ? "not-configured-admin-correction"
          : "api-unavailable-admin-correction",
      };

  const result = correctTop5Submission(
    guildId,
    user.id,
    resolvedName,
    marketValue,
    metadata,
    actor,
  );

  return {
    ...result,
    lookup,
    marketValueAvailable: result.ok && result.submission.marketValue !== null,
  };
}

/**
 * Retry a missing market value without replacing the player's submission.
 * A value fetched now is clearly labelled as recovered, not represented as
 * an exact historic price from the original submission time.
 */
export async function retryMissingTop5MarketValue(guildId, userId) {
  const existing = getTop5SubmissionForUser(guildId, userId);
  if (!existing) return { ok: false, code: "NOT_FOUND", error: "Keine Top-5-Abgabe in der aktuellen Runde vorhanden." };
  if (existing.marketValue !== null && existing.marketValue !== undefined) {
    return { ok: false, code: "ALREADY_SET", error: "Der Marktwert ist bereits hinterlegt.", submission: existing };
  }

  const playerName = sanitizePlayerName(existing.submittedPlayerName || existing.playerName);
  const lookup = await resolveKickbasePlayerMarketValue(playerName);
  console.log(`💰 Top-5 MW retry for ${userId} / ${playerName}: ${lookup.ok ? "OK" : lookup.code || "FAILED"}`);

  if (!lookup.ok) return {
    ok: false,
    code: lookup.code || "API_ERROR",
    error: lookup.error || "Kickbase-Marktwert aktuell nicht erreichbar.",
    suggestions: lookup.suggestions || [],
  };
  if (!Number.isFinite(lookup.marketValue)) return {
    ok: false,
    code: "VALUE_MISSING",
    error: "Kickbase hat den Spieler gefunden, aber derzeit keinen gültigen Marktwert geliefert.",
  };
  return attachTop5MarketValue(guildId, userId, lookup);
}

export function formatTop5SubmissionLine(userId, submission) {
  const marketValue = formatMarketValue(submission?.marketValue);
  const lateLabel = submission?.submittedLate ? " • ⚠️ **verspätet nachgereicht**" : "";
  const createdAt = new Date(submission?.createdAt || 0);
  const correctedTimeLabel = submission?.correctedAt && !Number.isNaN(createdAt.getTime())
    ? ` • ursprüngliche Abgabe: <t:${Math.floor(createdAt.getTime() / 1000)}:f>`
    : "";
  return `Manager: <@${userId}> hat **${submission.playerName}** abgegeben. • MW: **${marketValue}**${lateLabel}${correctedTimeLabel}`;
}

export function formatTop5Entry(entry) {
  return `**${entry.playerName}** — MW: **${formatMarketValue(entry.marketValue)}**`;
}
