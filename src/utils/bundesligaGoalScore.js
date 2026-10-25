/**
 * ESPN soccer keyEvents/scoringPlays attribute item.team to the team that
 * benefits from a goal. For an own goal, this is the OPPONENT of the named
 * player. The team must not be flipped a second time.
 */
function nonNegativeInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Advance the score by exactly one goal. Prefer ESPN's credited team id;
 * only fall back to the event's reported score if it is a coherent +1 update
 * and the credited side cannot be determined.
 *
 * Using the credited team also avoids carrying an incorrect ESPN per-event
 * score into all subsequent goal announcements.
 */
export function advanceBundesligaGoalScore(previous, goal, sides) {
  const home = nonNegativeInt(previous?.home) ?? 0;
  const away = nonNegativeInt(previous?.away) ?? 0;
  const teamId = String(goal?.teamId || "").trim();
  const homeId = String(sides?.home?.id || "").trim();
  const awayId = String(sides?.away?.id || "").trim();
  const creditedSide = teamId && homeId && teamId === homeId
    ? "home"
    : teamId && awayId && teamId === awayId
      ? "away"
      : null;

  const reportedHome = nonNegativeInt(goal?.homeScore);
  const reportedAway = nonNegativeInt(goal?.awayScore);
  const reported = reportedHome !== null && reportedAway !== null
    ? { home: reportedHome, away: reportedAway }
    : null;

  if (creditedSide) {
    const expected = {
      home: home + (creditedSide === "home" ? 1 : 0),
      away: away + (creditedSide === "away" ? 1 : 0),
    };
    return {
      ...expected,
      verified: true,
      conflict: Boolean(reported
        && (reported.home !== expected.home || reported.away !== expected.away)),
    };
  }

  if (reported
    && reported.home >= home
    && reported.away >= away
    && (reported.home - home) + (reported.away - away) === 1) {
    return { ...reported, verified: true, conflict: false };
  }

  // Avoid announcing an invented score when neither ESPN source identifies
  // the credited team (particularly important for own goals).
  return { home, away, verified: false, conflict: false };
}
