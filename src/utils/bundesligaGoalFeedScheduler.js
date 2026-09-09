import crypto from "crypto";
import { buildKbbEmbed } from "./embeds.js";
import { getManagers } from "./managerStore.js";
import { getKickbaseLiveOwnership } from "./kickbaseLiveOwnership.js";

const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard";
const ESPN_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/summary";
const TEST_CHANNEL_ID = process.env.KBB_TEST_CHANNEL_ID || "1522249317656690929";
const POLL_INTERVAL_MS = Math.max(20_000, Number(process.env.KBB_GOAL_FEED_INTERVAL_MS || 30_000));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.KBB_GOAL_FEED_TIMEOUT_MS || 10000));
const INITIAL_BACKFILL = Math.max(0, Math.min(3, Number(process.env.KBB_GOAL_INITIAL_BACKFILL || 1)));
const MARKER_PREFIX = "KBBGOAL:";
const HISTORY_SCAN_LIMIT = 100;

const guildStates = new Map();
const runningGuilds = new Set();
const discordManagerMapCache = new Map();

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

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getLiveEvents(scoreboard) {
  const events = Array.isArray(scoreboard?.events) ? scoreboard.events : [];
  return events.filter(event => {
    const type = event?.status?.type || {};
    return type.state === "in" && type.completed !== true;
  });
}

function getCompetition(event) {
  return Array.isArray(event?.competitions) ? event.competitions[0] || null : null;
}

function getMatchTeams(event) {
  const competition = getCompetition(event);
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find(item => item?.homeAway === "home") || competitors[0] || null;
  const away = competitors.find(item => item?.homeAway === "away") || competitors[1] || null;

  const mapTeam = team => ({
    id: String(team?.id ?? team?.team?.id ?? "").trim() || null,
    name: String(team?.team?.displayName ?? team?.team?.shortDisplayName ?? team?.team?.name ?? "Unbekannt").trim(),
    abbreviation: String(team?.team?.abbreviation ?? "").trim(),
    score: asNumber(team?.score),
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
    if (!match?.[1]) continue;
    return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  return null;
}

function parseScorerFromText(text) {
  const value = String(text || "");
  const match = value.match(/\.\s*([^.(]+?)\s*\([^)]*\)\s*(?:right|left|header|converts|scores|with)/i);
  return match?.[1]?.trim() || null;
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
  return {
    minute,
    added,
    display: added ? `${minute}+${added}` : String(minute),
  };
}

function goalSortValue(goal, index) {
  const period = asNumber(goal?.period?.number ?? goal?.period) || 0;
  const clock = parseMinute(goal?.clock?.displayValue ?? goal?.clock);
  return period * 100000 + clock.minute * 100 + clock.added + index / 1000;
}

function goalKey(eventId, goal, scorer, score) {
  const explicit = String(goal?.id ?? goal?.uid ?? goal?.sequenceNumber ?? "").trim();
  if (explicit) return `${eventId}:${explicit}`;

  const raw = [
    eventId,
    goal?.period?.number ?? goal?.period,
    goal?.clock?.displayValue ?? goal?.clock,
    goal?.team?.id,
    scorer,
    score,
    goal?.text,
  ].join("|");

  return `${eventId}:${crypto.createHash("sha1").update(raw).digest("hex").slice(0, 18)}`;
}

function getGoals(summary, event) {
  const rawGoals = Array.isArray(summary?.keyEvents)
    ? summary.keyEvents.filter(item => item?.scoringPlay === true && item?.shootout !== true)
    : [];

  const teams = getMatchTeams(event);
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

        if (scoringTeamId && scoringTeamId === teams.home.id) homeScore += 1;
        else if (scoringTeamId && scoringTeamId === teams.away.id) awayScore += 1;
        else {
          // If ESPN omits the team on a rare event, keep the last known score rather than inventing one.
          const currentHome = teams.home.score;
          const currentAway = teams.away.score;
          if (rawGoals.length === 1 && currentHome !== null && currentAway !== null) {
            homeScore = currentHome;
            awayScore = currentAway;
          }
        }
      }

      const minute = parseMinute(goal?.clock?.displayValue ?? goal?.clock);
      const score = `${homeScore}:${awayScore}`;

      return {
        raw: goal,
        scorer: people.scorer,
        assist: people.assist,
        ownGoal,
        penalty,
        minute: minute.display,
        score,
        homeScore,
        awayScore,
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

function addUniqueMapValue(map, key, value) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, value);
    return;
  }

  const existing = map.get(key);
  if (!existing || existing.managerId !== value.managerId || existing.playerId !== value.playerId) {
    map.set(key, null);
  }
}

function buildKickbasePlayerIndex(players) {
  const exact = new Map();
  const surname = new Map();

  for (const player of players || []) {
    const fullKey = normalize(player.playerName);
    if (!fullKey) continue;
    addUniqueMapValue(exact, fullKey, player);

    const tokens = fullKey.split(" ").filter(Boolean);
    const last = tokens[tokens.length - 1];
    if (last) addUniqueMapValue(surname, last, player);
  }

  return { exact, surname };
}

function resolveKickbaseOwner(playerName, index) {
  const key = normalize(playerName);
  if (!key) return null;

  const exact = index.exact.get(key);
  if (exact) return exact;

  const tokens = key.split(" ").filter(Boolean);
  const last = tokens[tokens.length - 1];
  return last ? index.surname.get(last) || null : null;
}

async function buildDiscordManagerMap(guild) {
  const cached = discordManagerMapCache.get(guild.id);
  if (cached && cached.expiresAt > Date.now()) return cached.map;

  const managers = getManagers(guild.id);
  const map = new Map();

  for (const manager of managers) {
    const member = guild.members.cache.get(manager.userId)
      || await guild.members.fetch(manager.userId).catch(() => null);
    if (!member) continue;

    const names = [
      manager.username,
      member.displayName,
      member.nickname,
      member.user?.username,
      member.user?.globalName,
    ].filter(Boolean);

    for (const name of names) {
      const key = normalize(name);
      if (!key) continue;
      if (map.has(key) && map.get(key) !== manager.userId) map.set(key, null);
      else if (!map.has(key)) map.set(key, manager.userId);
    }
  }

  discordManagerMapCache.set(guild.id, { map, expiresAt: Date.now() + 5 * 60_000 });
  return map;
}

function ownerTag(owner, discordManagerMap) {
  if (!owner?.managerName) return { text: "", userId: null };
  const userId = discordManagerMap.get(normalize(owner.managerName));
  if (userId) return { text: ` (<@${userId}>)`, userId };
  return { text: ` (**${escapeDiscordText(owner.managerName)}**)`, userId: null };
}

function buildGoalPost(event, goal, kickbaseIndex, discordManagerMap) {
  const teams = getMatchTeams(event);
  const scorerOwner = resolveKickbaseOwner(goal.scorer, kickbaseIndex);
  const assistOwner = goal.assist ? resolveKickbaseOwner(goal.assist, kickbaseIndex) : null;
  const scorerTag = ownerTag(scorerOwner, discordManagerMap);
  const assistTag = ownerTag(assistOwner, discordManagerMap);
  const scorer = escapeDiscordText(goal.scorer);
  const assist = goal.assist ? escapeDiscordText(goal.assist) : null;
  const flags = [goal.penalty ? "Elfmeter" : null, goal.ownGoal ? "Eigentor" : null].filter(Boolean);

  const description = [
    `## ⚽ **${goal.score} durch ${scorer}**${scorerTag.text}`,
    assist ? `🎯 Vorlage: **${assist}**${assistTag.text}` : null,
    flags.length ? `ℹ️ ${flags.join(" • ")}` : null,
    "",
    `**${escapeDiscordText(teams.home.name)} ${goal.score} ${escapeDiscordText(teams.away.name)}**`,
    `⏱️ **${goal.minute}. Minute**`,
  ].filter(Boolean).join("\n");

  return {
    embed: buildKbbEmbed({
      title: "🚨 TOR IN DER BUNDESLIGA!",
      description,
      footer: `187 KICKBASEBANDE • LIVE TEST • ${MARKER_PREFIX}${goal.key}`,
    }),
    mentionUserIds: [...new Set([scorerTag.userId, assistTag.userId].filter(Boolean))],
  };
}

async function fetchSummary(eventId) {
  const url = new URL(ESPN_SUMMARY_URL);
  url.searchParams.set("event", String(eventId));
  return fetchJson(url.toString());
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
      console.log(`⚽ Goal-feed recovery ${guild.name}: ${state.seen.size} known goal marker(s)`);
    }

    const scoreboard = await fetchJson(ESPN_SCOREBOARD_URL);
    const liveEvents = getLiveEvents(scoreboard);
    if (!liveEvents.length) return;

    console.log(`⚽ Bundesliga live feed: ${liveEvents.length} live match(es)`);

    const [kickbaseLive, discordManagerMap] = await Promise.all([
      getKickbaseLiveOwnership(),
      buildDiscordManagerMap(guild),
    ]);

    const kickbaseIndex = buildKickbasePlayerIndex(kickbaseLive.ok ? kickbaseLive.players : []);
    if (!kickbaseLive.ok) {
      console.warn(`⚠️ Goal-feed Kickbase ownership unavailable: ${kickbaseLive.error || kickbaseLive.code}`);
    }

    for (const event of liveEvents) {
      const eventId = String(event?.id || "").trim();
      if (!eventId) continue;

      const summary = await fetchSummary(eventId).catch(error => {
        console.warn(`⚠️ ESPN summary failed for ${eventId}: ${error?.message || error}`);
        return null;
      });
      if (!summary) continue;

      const goals = getGoals(summary, event);
      const firstObservation = !state.initializedEvents.has(eventId);
      state.initializedEvents.add(eventId);

      let candidates = goals.filter(goal => !state.seen.has(goal.key));
      if (firstObservation && candidates.length > INITIAL_BACKFILL) {
        const skipped = candidates.slice(0, candidates.length - INITIAL_BACKFILL);
        for (const goal of skipped) state.seen.add(goal.key);
        candidates = candidates.slice(-INITIAL_BACKFILL);
      }

      for (const goal of candidates) {
        const post = buildGoalPost(event, goal, kickbaseIndex, discordManagerMap);
        const sent = await channel.send({
          embeds: [post.embed],
          allowedMentions: { users: post.mentionUserIds, parse: [] },
        }).catch(error => {
          console.error(`❌ Goal-feed post failed for ${guild.id}:`, error?.message || error);
          return null;
        });

        if (!sent) continue;
        state.seen.add(goal.key);
        console.log(`✅ Goal-feed posted: ${goal.score} ${goal.scorer} (${eventId})`);
      }
    }
  } catch (error) {
    console.error(`❌ Bundesliga goal-feed poll failed for ${guild.id}:`, error?.message || error);
  } finally {
    runningGuilds.delete(guild.id);
  }
}

export function startBundesligaGoalFeedScheduler(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      await processGuild(guild);
    }
  };

  setTimeout(() => run().catch(() => null), 20_000);
  console.log(`⚽ Experimental Bundesliga goal feed active: channel=${TEST_CHANNEL_ID}, interval=${POLL_INTERVAL_MS}ms`);
  return setInterval(() => run().catch(() => null), POLL_INTERVAL_MS);
}
