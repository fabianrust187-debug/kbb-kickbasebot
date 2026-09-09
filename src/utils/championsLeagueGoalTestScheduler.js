import crypto from "crypto";
import { buildKbbEmbed } from "./embeds.js";

const ESPN_LEAGUE = process.env.KBB_GOAL_TEST_LEAGUE || "uefa.champions";
const TEST_EVENT_ID = process.env.KBB_GOAL_TEST_EVENT_ID || "74165884";
const TEST_MATCH_LABEL = process.env.KBB_GOAL_TEST_MATCH_LABEL || "Liverpool – Atlético Madrid";
const TEST_CHANNEL_ID = process.env.KBB_TEST_CHANNEL_ID || "1522249317656690929";
const POLL_INTERVAL_MS = Math.max(20_000, Number(process.env.KBB_GOAL_FEED_INTERVAL_MS || 30_000));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.KBB_GOAL_FEED_TIMEOUT_MS || 10000));
const INITIAL_BACKFILL = Math.max(0, Math.min(3, Number(process.env.KBB_UCL_TEST_INITIAL_BACKFILL || 1)));
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
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/scoreboard`;
}

function summaryUrl() {
  const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/summary`);
  url.searchParams.set("event", TEST_EVENT_ID);
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

function getTargetEvent(scoreboard) {
  const events = Array.isArray(scoreboard?.events) ? scoreboard.events : [];
  return events.find(event => String(event?.id || "") === String(TEST_EVENT_ID)) || null;
}

function isLive(event) {
  const type = event?.status?.type || {};
  return type.state === "in" && type.completed !== true;
}

function isCompleted(event) {
  return event?.status?.type?.completed === true || event?.status?.type?.state === "post";
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
    ?? participant?.name
    ?? "",
  ).trim();
}

function parseAssistFromText(text) {
  const value = String(text || "");
  const patterns = [
    /assisted\s+by\s+([^.;]+)/i,
    /assist(?:ed)?\s*:\s*([^.;]+)/i,
    /vorlage\s*(?:von|:)\s*([^.;]+)/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  }
  return null;
}

function parseScorerFromText(text) {
  const value = String(text || "");
  const patterns = [
    /^\s*([^,.]+?)\s+Goal/i,
    /\.\s*([^.(]+?)\s*\([^)]*\)\s*(?:right|left|header|converts|scores|with)/i,
  ];

  for (const pattern of patterns) {
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

function goalKey(goal, scorer, score) {
  const explicit = String(goal?.id ?? goal?.uid ?? goal?.sequenceNumber ?? "").trim();
  if (explicit) return `${TEST_EVENT_ID}:${explicit}`;

  const raw = [
    TEST_EVENT_ID,
    goal?.period?.number ?? goal?.period,
    goal?.clock?.displayValue ?? goal?.clock,
    goal?.team?.id,
    scorer,
    score,
    goal?.text,
  ].join("|");

  return `${TEST_EVENT_ID}:${crypto.createHash("sha1").update(raw).digest("hex").slice(0, 18)}`;
}

function getGoals(summary, event) {
  const rawGoals = Array.isArray(summary?.keyEvents)
    ? summary.keyEvents.filter(item => item?.scoringPlay === true && item?.shootout !== true)
    : [];

  const teams = getTeams(event);
  let homeScore = 0;
  let awayScore = 0;

  return rawGoals
    .map((goal, index) => ({ goal, index, sortValue: goalSortValue(goal, index) }))
    .sort((a, b) => a.sortValue - b.sortValue)
    .map(({ goal }) => {
      const people = extractGoalPeople(goal);
      const ownGoal = goal?.ownGoal === true || normalize(goal?.type?.text).includes("own goal");
      const penalty = goal?.penalty === true || normalize(goal?.type?.text).includes("penalty");
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
        key: goalKey(goal, people.scorer, score),
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

function buildGoalPost(event, goal) {
  const teams = getTeams(event);
  const scorer = escapeDiscordText(goal.scorer);
  const assist = goal.assist ? escapeDiscordText(goal.assist) : null;
  const flags = [goal.penalty ? "Elfmeter" : null, goal.ownGoal ? "Eigentor" : null].filter(Boolean);

  return buildKbbEmbed({
    title: "🧪🚨 TOR-TEST: CHAMPIONS LEAGUE",
    description: [
      `## ⚽ **${goal.score} durch ${scorer}**`,
      assist ? `🎯 Vorlage: **${assist}**` : null,
      flags.length ? `ℹ️ ${flags.join(" • ")}` : null,
      "",
      `**${escapeDiscordText(teams.home.name)} ${goal.score} ${escapeDiscordText(teams.away.name)}**`,
      `⏱️ **${goal.minute}. Minute**`,
      "",
      "🧪 Temporärer Live-Test für den Bundesliga-Torfeed.",
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
      state = { hydrated: false, seen: new Set(), initialized: false, completedLogged: false };
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
      console.warn(`⚠️ UCL goal-test event ${TEST_EVENT_ID} not found on scoreboard.`);
      return;
    }

    if (isCompleted(event)) {
      if (!state.completedLogged) {
        console.log(`🏁 UCL goal-test completed: ${TEST_MATCH_LABEL} (${TEST_EVENT_ID})`);
        state.completedLogged = true;
      }
      return;
    }

    if (!isLive(event)) return;

    const summary = await fetchJson(summaryUrl());
    const goals = getGoals(summary, event);
    const firstObservation = !state.initialized;
    state.initialized = true;

    let candidates = goals.filter(goal => !state.seen.has(goal.key));
    if (firstObservation && candidates.length > INITIAL_BACKFILL) {
      const skipped = candidates.slice(0, candidates.length - INITIAL_BACKFILL);
      for (const goal of skipped) state.seen.add(goal.key);
      candidates = candidates.slice(-INITIAL_BACKFILL);
    }

    for (const goal of candidates) {
      const sent = await channel.send({
        embeds: [buildGoalPost(event, goal)],
        allowedMentions: { parse: [] },
      }).catch(error => {
        console.error(`❌ UCL goal-test post failed for ${guild.id}:`, error?.message || error);
        return null;
      });

      if (!sent) continue;
      state.seen.add(goal.key);
      console.log(`✅ UCL goal-test posted: ${goal.score} ${goal.scorer} (${TEST_EVENT_ID})`);
    }
  } catch (error) {
    console.error(`❌ UCL goal-test poll failed for ${guild.id}:`, error?.message || error);
  } finally {
    runningGuilds.delete(guild.id);
  }
}

export function startChampionsLeagueGoalTestScheduler(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      await processGuild(guild);
    }
  };

  setTimeout(() => run().catch(() => null), 10_000);
  console.log(`🧪 UCL goal test active: ${TEST_MATCH_LABEL}, event=${TEST_EVENT_ID}, channel=${TEST_CHANNEL_ID}, interval=${POLL_INTERVAL_MS}ms`);
  return setInterval(() => run().catch(() => null), POLL_INTERVAL_MS);
}
