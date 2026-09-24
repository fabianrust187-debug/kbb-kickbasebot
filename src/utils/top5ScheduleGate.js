const ESPN_SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard";
const TIME_ZONE = "Europe/Berlin";
const TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const ERROR_CACHE_TTL_MS = 10 * 60_000;

const cache = new Map();

function berlinParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    weekday: map.weekday,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function addDays(parts, days) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function dateKey(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function espnDate(parts) {
  return `${String(parts.year).padStart(4, "0")}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
}

function currentWindowFriday(parts) {
  const daysBack = {
    Fri: 0,
    Sat: 1,
    Sun: 2,
    Mon: 3,
    Tue: 4,
  }[parts.weekday];
  if (daysBack === undefined) return null;
  return addDays(parts, -daysBack);
}

async function fetchScoreboard(parts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = new URL(ESPN_SCOREBOARD_BASE);
    url.searchParams.set("dates", espnDate(parts));
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.events) ? data.events : [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function shouldStartScheduledTop5Round(now = new Date()) {
  const parts = berlinParts(now);
  const friday = currentWindowFriday(parts);
  if (!friday) {
    return { ok: true, shouldStart: false, reason: "outside-regular-window" };
  }

  const fridayKey = dateKey(friday);
  const cached = cache.get(fridayKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const weekendDates = [friday, addDays(friday, 1), addDays(friday, 2)];
  let successfulRequests = 0;
  let fixtureCount = 0;
  const errors = [];

  for (const day of weekendDates) {
    try {
      const events = await fetchScoreboard(day);
      successfulRequests += 1;
      fixtureCount += events.length;
    } catch (error) {
      errors.push(`${dateKey(day)}: ${error?.message || error}`);
    }
  }

  let result;
  let ttl = CACHE_TTL_MS;
  if (successfulRequests === 0) {
    result = {
      ok: false,
      shouldStart: false,
      fridayKey,
      error: `Bundesliga-Spielplan konnte nicht geprüft werden (${errors.join("; ")}).`,
    };
    ttl = ERROR_CACHE_TTL_MS;
  } else if (fixtureCount === 0) {
    result = {
      ok: true,
      shouldStart: false,
      fridayKey,
      fixtureCount: 0,
      reason: "no-bundesliga-fixtures",
    };
  } else {
    result = {
      ok: true,
      shouldStart: true,
      fridayKey,
      fixtureCount,
      reason: "bundesliga-matchday",
    };
  }

  cache.set(fridayKey, { result, expiresAt: Date.now() + ttl });
  return result;
}
