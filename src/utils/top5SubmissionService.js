import { formatMarketValue, resolveKickbasePlayerMarketValue } from "./kickbaseApi.js";
import { addTop5Submission, getTop5SubmissionForUser, sanitizePlayerName } from "./top5Store.js";

export async function submitTop5WithMarketValue(guildId, user, inputName, target) {
  const existing = getTop5SubmissionForUser(guildId, user?.id);
  if (existing) {
    return {
      ok: false,
      duplicate: true,
      submission: existing,
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
        source: lookup.source,
        competitionId: lookup.competitionId,
        leagueId: lookup.leagueId,
      }
    : {
        submittedPlayerName,
        source: lookup.code === "NOT_CONFIGURED" ? "not-configured" : "api-unavailable",
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
    lookup,
    marketValueAvailable: result.ok && result.submission.marketValue !== null,
  };
}

export function formatTop5SubmissionLine(userId, submission) {
  const marketValue = formatMarketValue(submission?.marketValue);
  return `Manager: <@${userId}> hat **${submission.playerName}** abgegeben. • MW: **${marketValue}**`;
}

export function formatTop5Entry(entry) {
  return `**${entry.playerName}** — MW: **${formatMarketValue(entry.marketValue)}**`;
}
