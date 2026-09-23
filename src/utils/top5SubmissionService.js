import { formatMarketValue, resolveKickbasePlayerMarketValue } from "./kickbaseApi.js";
import { isTop5DeadlinePassed } from "./top5Deadline.js";
import {
  addTop5Submission,
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

export function formatTop5SubmissionLine(userId, submission) {
  const marketValue = formatMarketValue(submission?.marketValue);
  const lateLabel = submission?.submittedLate ? " • ⚠️ **verspätet nachgereicht**" : "";
  return `Manager: <@${userId}> hat **${submission.playerName}** abgegeben. • MW: **${marketValue}**${lateLabel}`;
}

export function formatTop5Entry(entry) {
  return `**${entry.playerName}** — MW: **${formatMarketValue(entry.marketValue)}**`;
}
