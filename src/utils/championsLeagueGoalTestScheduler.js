import crypto from "crypto";
import { buildKbbEmbed } from "./embeds.js";

const ESPN_LEAGUE = process.env.KBB_GOAL_TEST_LEAGUE || "uefa.champions";
const TEST_DATE = process.env.KBB_GOAL_TEST_DATE || "20260909";
const TEST_EVENT_ID = String(process.env.KBB_GOAL_TEST_ESPN_EVENT_ID || "").trim();
const TEST_HOME = process.env.KBB_GOAL_TEST_HOME || "Liverpool";
const TEST_AWAY = process.env.KBB_GOAL_TEST_AWAY || "Atletico Madrid";
const TEST_MATCH_LABEL = process.env.KBB_GOAL_TEST_MATCH_LABEL || "Liverpool – Atlético Madrid";
const TEST_CHANNEL_ID = process.env.KBB_TEST_CHANNEL_ID || "1522249317656690929";
const POLL_INTERVAL_MS = Math.max(20_000, Number(process.env.KBB_GOAL_FEED_INTERVAL_MS || 30_000));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.KBB_GOAL_FEED_TIMEOUT_MS || 10000));
const LIVE_INITIAL_BACKFILL = Math.max(0, Math.min(3, Number(process.env.KBB_UCL_TEST_INITIAL_BACKFILL || 1)));
const COMPLETED_BACKFILL = Math.max(0, Math.min(15, Number(process.env.KBB_UCL_TEST_COMPLETED_BACKFILL || 10)));
const MARKER_PREFIX = "KBBUCLTEST:";
const HISTORY_SCAN_LIMIT = 100;

const runningGuilds = new Set();
const guildStates = new Map();

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeDiscordText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`>|])/g, "\\$1");
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreboardUrl() {
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/scoreboard`);
  url.searchParams.set("dates", TEST_DATE);
  return url.toString();
}

function summaryUrl(eventId) {
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/summary`);
  url.searchParams.set("event", String(eventId));
  return url.toString();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getCompetition(event) {
  return Array.isArray(event?.competitions) ? event.competitions[0] || null : null;
}

function getTeams(event) {
  const competitors = Array.isArray(getCompetition(event)?.competitors)
    ? getCompetition(event).competitors
    : [];
  const home = competitors.find(item => item?.homeAway === "home") || competitors[0] || null;
  const away = competitors.find(item => item?.homeAway === "away") || competitors[1] || null;

  const mapTeam = item => ({
    id: String(item?.id ?? item?.team?.id ?? "").trim() || null,
    name: String(item?.team?.displayName ?? item?.team?.shortDisplayName ?? item?.team?.name ?? "Unbekannt").trim(),
    score: asNumber(item?.score),
  });

  return { home: mapTeam(home), away: mapTeam(away) };
}

function teamMatches(actual, wanted) {
  const a = normalize(actual);
  const w = normalize(wanted);
  return Boolean(a && w && (a === w || a.includes(w) || w.includes(a)));
}

function getTargetEvent(scoreboard) {
  const events = Array.isArray(scoreboard?.events) ? scoreboard.events : [];

  if (TEST_EVENT_ID) {
    const direct = events.find(event => String(event?.id || "") === TEST_EVENT_ID);
    if (direct) return direct;
  }

  return events.find(event => {
    const teams = getTeams(event);
    const direct = teamMatches(teams.home.name, TEST_HOME) && teamMatches(teams.away.name, TEST_AWAY);
    const reversed = teamMatches(teams.home.name, TEST_AWAY) && teamMatches(teams.away.name, TEST_HOME);
    return direct || reversed;
  }) || null;
}

function isLive(event) {
  const type = event?.status?.type || {};
  return type.state === "in" && type.completed !== true;
}

function isCompleted(event) {
  return event?.status?.type?.completed === true || event?.status?.type?.state === "post";
}

function participantRole(participant) {
  const type = participant?.type;
  if (typeof type === "string") return normalize(type);
  return normalize(type?.text ?? type?.name ?? type?.displayName ?? type?.abbreviation ?? "");
}

function participantName(participant) {
  return String(
    participant?.athlete?.displayName
    ?? participant?.athlete?.fullName
    ?? participant?.athlete?.shortName
    ?? participant?.displayName
    ?? participant?.fullName
    ?? participant?.shortName
    ?? participant?.name
    ?? "",
  ).trim();
}

function parseAssistFromText(text) {
  const value = String(text || "");
  for (const pattern of [
    /assisted\s+by\s+([^.;]+)/i,
    /assist(?:ed)?\s*:\s*([^.;]+)/i,
    /vorlage\s*(?:von|:)\s*([^.;]+)/i,
  ]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  }
  return null;
}

function parseScorerFromText(text) {
  const value = String(text || "");
  for (const pattern of [
    /^\s*([^,.]+?)\s+Goal/i,
    /\.\s*([^.(]+?)\s*\([^)]*\)\s*(?:right|left|header|converts|scores|with)/i,
  ]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractGoalPeople(goal) {
  const participants = Array.isArray(goal?.participants)
    ? goal.participants
    : Array.isArray(goal?.athletesInvolved)
      ? goal.athletesInvolved
      : [];

  let scorerParticipant = participants.find(item => {
    const role = participantRole(item);
    return (role.includes("scor") || role.includes("goal")) && !role.includes("assist");
  });
  if (!scorerParticipant) {
    scorerParticipant = participants.find(item => Number(item?.order) === 1) || participants[0] || null;
  }

  const assistParticipant = participants.find(item => participantRole(item).includes("assist")) || null;
  const text = `${goal?.shortText || ""} ${goal?.text || ""}`.trim();

  return {
    scorer: participantName(scorerParticipant) || parseScorerFromText(text) || "Unbekannter Torschütze",
    assist: participantName(assistParticipant) || parseAssistFromText(text),
  };
}

function parseMinute(value) {
  const text = String(value || "");
  const match = text.match(/(\d+)(?:\D+\+\D*(\d+))?/);
  if (!match) return { minute: 999, added: 0, display: text || "?" };
  const minute = Number(match[1]);
  const added = Number(match[2] || 0);
  return { minute, added, display: added ? `${minute}+${added}` : String(minute) };
}

function goalSortValue(goal, index) {
  const period = asNumber(goal?.period?.number ?? goal?.period) || 0;
  const clock = parseMinute(goal?.clock?.displayValue ?? goal?.clock);
  return period * 100000 + clock.minute * 100 + clock.added + index / 1000;
}

function scoringEntries(summary, event) {
  const candidates = [
    ...(Array.isArray(summary?.keyEvents) ? summary.keyEvents : []),
    ...(Array.isArray(summary?.header?.competitions?.[0]?.details) ? summary.header.competitions[0].details : []),
    ...(Array.isArray(summary?.details) ? summary.details : []),
    ...(Array.isArray(getCompetition(event)?.details) ? getCompetition(event).details : []),
  ].filter(item => item?.scoringPlay === true && item?.shootout !== true);

  const seen = new Set();
  return candidates.filter((goal, index) => {
    const athletes = Array.isArray(goal?.athletesInvolved)
      ? goal.athletesInvolved.map(participantName).join("|")
      : "";
    const key = String(goal?.id ?? goal?.uid ?? goal?.sequenceNumber ?? [
      goal?.clock?.displayValue ?? goal?.clock,
      goal?.team?.id,
      goal?.type?.text,
      athletes,
      goal?.text,
      index,
    ].join("|"));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function goalKey(eventId, goal, scorer, score) {
  const explicit = String(goal?.id ?? goal?.uid ?? goal?.sequenceNumber ?? "").trim();
  if (explicit) return `${eventId}:${explicit}`;
  const raw = [eventId, goal?.period?.number ?? goal?.period, goal?.clock?.displayValue ?? goal?.clock, goal?.team?.id, scorer, score, goal?.text].join("|");
  return `${eventId}:${crypto.createHash("sha1").update(raw).digest("hex").slice(0, 18)}`;
}

function getGoals(summary, event) {
  const rawGoals = scoringEntries(summary, event);
  const teams = getTeams(event);
  let homeScore = 0;
  let awayScore = 0;

  return rawGoals
    .map((goal, index) => ({ goal, index, sortValue: goalSortValue(goal, index) }))
    .sort((a, b) => a.sortValue - b.sortValue)
    .map(({ goal }) => {
      const people = extractGoalPeople(goal);
      const ownGoal = goal?.ownGoal === true || normalize(goal?.type?.text).includes("own goal");
      const penalty = goal?.penaltyKick === true || goal?.penalty === true || normalize(goal?.type?.text).includes("penalty");
      const eventHomeScore = asNumber(goal?.homeScore);
      const eventAwayScore = asNumber(goal?.awayScore);

      if (eventHomeScore !== null && eventAwayScore !== null) {
        homeScore = eventHomeScore;
        awayScore = eventAwayScore;
      } else {
        let scoringTeamId = String(goal?.team?.id ?? "").trim();
        if (ownGoal && scoringTeamId) {
          if (scoringTeamId === teams.home.id) scoringTeamId = teams.away.id;
          else if (scoringTeamId === teams.away.id) scoringTeamId = teams.home.id;
        }
        if (scoringTeamId === teams.home.id) homeScore += 1;
        else if (scoringTeamId === teams.away.id) awayScore += 1;
      }

      const minute = parseMinute(goal?.clock?.displayValue ?? goal?.clock);
      const score = `${homeScore}:${awayScore}`;
      return {
        scorer: people.scorer,
        assist: people.assist,
        ownGoal,
        penalty,
        minute: minute.display,
        score,
        key: goalKey(String(event?.id || "event"), goal, people.scorer, score),
      };
    });
}

function extractMarker(message) {
  for (const embed of message?.embeds || []) {
    const footer = String(embed?.footer?.text || "");
    const index = footer.indexOf(MARKER_PREFIX);
    if (index < 0) continue;
    const marker = footer.slice(index + MARKER_PREFIX.length).trim().split(/\s+/)[0];
    if (marker) return marker;
  }
  return null;
}

async function hydrateSeen(channel, botUserId) {
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

function buildGoalPost(event, goal, completed = false) {
  const teams = getTeams(event);
  const scorer = escapeDiscordText(goal.scorer);
  const assist = goal.assist ? escapeDiscordText(goal.assist) : null;
  const flags = [goal.penalty ? "Elfmeter" : null, goal.ownGoal ? "Eigentor" : null].filter(Boolean);

  return buildKbbEmbed({
    title: completed ? "🧪⚽ TOR-BACKFILL: CHAMPIONS LEAGUE" : "🧪🚨 TOR-TEST: CHAMPIONS LEAGUE",
    description: [
      `## ⚽ **${goal.score} durch ${scorer}**`,
      assist ? `🎯 Vorlage: **${assist}**` : null,
      flags.length ? `ℹ️ ${flags.join(" • ")}` : null,
      "",
      `**${escapeDiscordText(teams.home.name)} ${goal.score} ${escapeDiscordText(teams.away.name)}**`,
      `⏱️ **${goal.minute}. Minute**`,
      "",
      completed ? "🧪 Nachträglicher Parser-Test eines bereits beendeten Spiels." : "🧪 Temporärer Live-Test für den Bundesliga-Torfeed.",
    ].filter(Boolean).join("\n"),
    footer: `187 KICKBASEBANDE • UCL LIVE TEST • ${MARKER_PREFIX}${goal.key}`,
  });
}

async function processGuild(guild) {
  if (runningGuilds.has(guild.id)) return;
  runningGuilds.add(guild.id);

  try {
    const channel = await guild.channels.fetch(TEST_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) return;

    let state = guildStates.get(guild.id);
    if (!state) {
      state = { hydrated: false, seen: new Set(), initializedEvents: new Set() };
      guildStates.set(guild.id, state);
    }

    if (!state.hydrated) {
      state.seen = await hydrateSeen(channel, guild.client.user?.id);
      state.hydrated = true;
      console.log(`🧪 UCL goal-test recovery ${guild.name}: ${state.seen.size} known marker(s)`);
    }

    const scoreboard = await fetchJson(scoreboardUrl());
    const event = getTargetEvent(scoreboard);
    if (!event) {
      const names = (scoreboard?.events || []).map(item => item?.name).filter(Boolean).slice(0, 10).join(" | ");
      console.warn(`⚠️ UCL goal-test match not found for ${TEST_DATE}: ${TEST_MATCH_LABEL}. Available: ${names || "none"}`);
      return;
    }

    const eventId = String(event.id);
    const completed = isCompleted(event);
    if (!completed && !isLive(event)) return;

    const summary = await fetchJson(summaryUrl(eventId));
    const goals = getGoals(summary, event);
    console.log(`🧪 UCL goal-test event resolved: ESPN=${eventId}, state=${completed ? "completed" : "live"}, goals=${goals.length}`);

    const firstObservation = !state.initializedEvents.has(eventId);
    state.initializedEvents.add(eventId);
    let candidates = goals.filter(goal => !state.seen.has(goal.key));

    if (firstObservation) {
      const backfillLimit = completed ? COMPLETED_BACKFILL : LIVE_INITIAL_BACKFILL;
      if (candidates.length > backfillLimit) {
        const skipped = candidates.slice(0, candidates.length - backfillLimit);
        for (const goal of skipped) state.seen.add(goal.key);
        candidates = candidates.slice(-backfillLimit);
      }
    }

    for (const goal of candidates) {
      const sent = await channel.send({
        embeds: [buildGoalPost(event, goal, completed)],
        allowedMentions: { parse: [] },
      }).catch(error => {
        console.error(`❌ UCL goal-test post failed for ${guild.id}:`, error?.message || error);
        return null;
      });
      if (!sent) continue;
      state.seen.add(goal.key);
      console.log(`✅ UCL goal-test posted: ${goal.score} ${goal.scorer} (ESPN ${eventId})`);
    }
  } catch (error) {
    console.error(`❌ UCL goal-test poll failed for ${guild.id}:`, error?.message || error);
  } finally {
    runningGuilds.delete(guild.id);
  }
}

export function startChampionsLeagueGoalTestScheduler(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) await processGuild(guild);
  };
  setTimeout(() => run().catch(() => null), 10_000);
  console.log(`🧪 UCL goal test active: ${TEST_MATCH_LABEL}, date=${TEST_DATE}, channel=${TEST_CHANNEL_ID}, interval=${POLL_INTERVAL_MS}ms`);
  return setInterval(() => run().catch(() => null), POLL_INTERVAL_MS);
}
