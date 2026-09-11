import crypto from "crypto";
import { buildKbbEmbed } from "./embeds.js";
import { getManagers } from "./managerStore.js";
import { getKickbaseLiveOwnership } from "./kickbaseLiveOwnership.js";

const ESPN_LEAGUE = "ger.1";
const ESPN_SCOREBOARD_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/scoreboard`;
const ESPN_SUMMARY_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/summary`;
const DEFAULT_GOAL_CHANNEL_ID = "1522249187666952254";
const GOAL_CHANNEL_ID = process.env.KBB_GOAL_CHANNEL_ID || DEFAULT_GOAL_CHANNEL_ID;
const POLL_INTERVAL_MS = Math.max(20_000, Number(process.env.KBB_GOAL_FEED_INTERVAL_MS || 30_000));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.KBB_GOAL_FEED_TIMEOUT_MS || 10000));
const MARKER_PREFIX = "KBBLIVE:";
const LEGACY_GOAL_MARKER_PREFIX = "KBBGOAL:";
const HISTORY_SCAN_LIMIT = 100;

const RED_CARD_POINTS = -75;
const YELLOW_RED_POINTS = -50;

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

function berlinDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
}

function scoreboardUrl(date = new Date()) {
  const url = new URL(ESPN_SCOREBOARD_BASE);
  url.searchParams.set("dates", berlinDateKey(date));
  return url.toString();
}

function summaryUrl(eventId) {
  const url = new URL(ESPN_SUMMARY_BASE);
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

function getMatchTeams(event) {
  const competition = getCompetition(event);
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = competitors.find(item => item?.homeAway === "home") || competitors[0] || null;
  const away = competitors.find(item => item?.homeAway === "away") || competitors[1] || null;

  const mapTeam = item => ({
    id: String(item?.id ?? item?.team?.id ?? "").trim() || null,
    name: String(item?.team?.displayName ?? item?.team?.shortDisplayName ?? item?.team?.name ?? "Unbekannt").trim(),
    score: asNumber(item?.score),
  });

  return { home: mapTeam(home), away: mapTeam(away) };
}

function isLive(event) {
  const type = event?.status?.type || {};
  return type.state === "in" && type.completed !== true;
}

function isCompleted(event) {
  const type = event?.status?.type || {};
  return type.completed === true || type.state === "post";
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

function eventText(item) {
  return [
    item?.shortText,
    item?.text,
    item?.description,
    item?.type?.text,
    item?.type?.displayName,
    item?.type?.name,
  ].filter(Boolean).join(" ").trim();
}

function getParticipants(item) {
  if (Array.isArray(item?.participants)) return item.participants;
  if (Array.isArray(item?.athletesInvolved)) return item.athletesInvolved;
  return [];
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
  const participants = getParticipants(goal);

  let scorerParticipant = participants.find(item => {
    const role = participantRole(item);
    return (role.includes("scor") || role.includes("goal")) && !role.includes("assist");
  });

  if (!scorerParticipant) {
    scorerParticipant = participants.find(item => Number(item?.order) === 1) || participants[0] || null;
  }

  const assistParticipant = participants.find(item => participantRole(item).includes("assist")) || null;
  const text = eventText(goal);

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

function actionSortValue(item, index) {
  const period = asNumber(item?.period?.number ?? item?.period) || 0;
  const clock = parseMinute(item?.clock?.displayValue ?? item?.clock);
  return period * 100000 + clock.minute * 100 + clock.added + index / 1000;
}

function allMatchEntries(summary, event) {
  const candidates = [
    ...(Array.isArray(summary?.keyEvents) ? summary.keyEvents : []),
    ...(Array.isArray(summary?.commentary) ? summary.commentary : []),
    ...(Array.isArray(summary?.header?.competitions?.[0]?.details) ? summary.header.competitions[0].details : []),
    ...(Array.isArray(summary?.details) ? summary.details : []),
    ...(Array.isArray(getCompetition(event)?.details) ? getCompetition(event).details : []),
  ];

  const seen = new Set();

  return candidates.filter((item, index) => {
    if (!item || typeof item !== "object") return false;

    const participants = getParticipants(item).map(participantName).filter(Boolean).join("|");
    const explicit = String(item?.id ?? item?.uid ?? item?.sequenceNumber ?? "").trim();
    const fallback = [
      item?.clock?.displayValue ?? item?.clock,
      item?.team?.id,
      item?.type?.text,
      participants,
      item?.text,
      item?.shortText,
      index,
    ].join("|");

    const key = explicit || fallback;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function actionKey(eventId, kind, item, playerName, extra = "") {
  const explicit = String(item?.id ?? item?.uid ?? item?.sequenceNumber ?? "").trim();
  if (explicit) return `${eventId}:${kind}:${explicit}`;

  const raw = [
    eventId,
    kind,
    item?.period?.number ?? item?.period,
    item?.clock?.displayValue ?? item?.clock,
    item?.team?.id,
    playerName,
    extra,
    item?.text,
    item?.shortText,
  ].join("|");

  return `${eventId}:${kind}:${crypto.createHash("sha1").update(raw).digest("hex").slice(0, 18)}`;
}

function getGoals(summary, event) {
  const rawGoals = allMatchEntries(summary, event)
    .filter(item => item?.scoringPlay === true && item?.shootout !== true);

  const teams = getMatchTeams(event);
  let homeScore = 0;
  let awayScore = 0;

  return rawGoals
    .map((goal, index) => ({ goal, index, sortValue: actionSortValue(goal, index) }))
    .sort((a, b) => a.sortValue - b.sortValue)
    .map(({ goal, index }) => {
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
        kind: "goal",
        raw: goal,
        playerName: people.scorer,
        scorer: people.scorer,
        assist: people.assist,
        ownGoal,
        penalty,
        minute: minute.display,
        score,
        sortValue: actionSortValue(goal, index),
        key: actionKey(String(event?.id || "event"), "goal", goal, people.scorer, score),
      };
    });
}

function parseCardPlayerFromText(text) {
  const value = String(text || "");

  for (const pattern of [
    /^([^,.]+?)\s+\([^)]+\)\s+is shown the red card/i,
    /^([^,.]+?)\s+\([^)]+\)\s+is shown the second yellow card/i,
    /red card[,:]\s*([^.;]+)/i,
    /second yellow card[,:]\s*([^.;]+)/i,
    /([^.;]+?)\s+is shown the red card/i,
    /([^.;]+?)\s+is shown the second yellow card/i,
  ]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function detectCardKind(item) {
  const text = normalize(eventText(item));
  const type = normalize(item?.type?.text ?? item?.type?.displayName ?? item?.type?.name ?? "");

  const yellowRed = item?.yellowRedCard === true
    || item?.secondYellow === true
    || text.includes("second yellow")
    || text.includes("yellow red")
    || text.includes("yellow-red")
    || text.includes("2nd yellow")
    || type.includes("second yellow")
    || type.includes("yellow red");

  if (yellowRed) return "yellow-red";

  const directRed = item?.redCard === true
    || text.includes("red card")
    || type.includes("red card");

  return directRed ? "red" : null;
}

function extractCardPlayer(item) {
  const participants = getParticipants(item);
  const preferred = participants.find(participant => {
    const role = participantRole(participant);
    return role.includes("player") || role.includes("card") || role.includes("recipient");
  });

  return participantName(preferred)
    || participantName(participants[0])
    || participantName(item?.athlete)
    || parseCardPlayerFromText(eventText(item));
}

function getCards(summary, event) {
  const eventId = String(event?.id || "event");

  return allMatchEntries(summary, event)
    .map((item, index) => ({ item, index, cardKind: detectCardKind(item) }))
    .filter(entry => entry.cardKind)
    .map(({ item, index, cardKind }) => {
      const playerName = extractCardPlayer(item);
      if (!playerName) return null;

      const minute = parseMinute(item?.clock?.displayValue ?? item?.clock);
      return {
        kind: "card",
        cardKind,
        raw: item,
        playerName,
        minute: minute.display,
        sortValue: actionSortValue(item, index),
        pointsPenalty: cardKind === "yellow-red" ? YELLOW_RED_POINTS : RED_CARD_POINTS,
        key: actionKey(eventId, `card-${cardKind}`, item, playerName),
      };
    })
    .filter(Boolean);
}

function isInjurySubstitution(item) {
  const text = normalize(eventText(item));
  const type = normalize(item?.type?.text ?? item?.type?.displayName ?? item?.type?.name ?? "");
  const substitution = item?.substitution === true
    || type.includes("substitution")
    || text.startsWith("substitution");

  if (!substitution) return false;

  return [
    "injury",
    "injured",
    "because of an injury",
    "due to injury",
    "following an injury",
    "unable to continue",
    "cannot continue",
    "forced off",
    "concussion",
    "medical",
    "verletz",
  ].some(signal => text.includes(signal));
}

function parseInjuredPlayerFromText(text) {
  const value = String(text || "");

  for (const pattern of [
    /replaces\s+(.+?)\s+(?:because of|due to|following)\s+(?:an?\s+)?injury/i,
    /(.+?)\s+is replaced by\s+.+?\s+(?:because of|due to|following)\s+(?:an?\s+)?injury/i,
    /(.+?)\s+(?:is|was)\s+unable to continue/i,
    /(.+?)\s+(?:is|was)\s+forced off/i,
  ]) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  return null;
}

function extractInjuredPlayer(item) {
  const participants = getParticipants(item);

  const outgoing = participants.find(participant => {
    const role = participantRole(participant);
    return role.includes("out") || role.includes("off") || role.includes("replaced");
  });

  const fromRole = participantName(outgoing);
  if (fromRole) return fromRole;

  const fromText = parseInjuredPlayerFromText(eventText(item));
  if (fromText) return fromText;

  return null;
}

function getInjuries(summary, event) {
  const eventId = String(event?.id || "event");

  return allMatchEntries(summary, event)
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isInjurySubstitution(item))
    .map(({ item, index }) => {
      const playerName = extractInjuredPlayer(item);
      if (!playerName) return null;

      const minute = parseMinute(item?.clock?.displayValue ?? item?.clock);
      return {
        kind: "injury",
        raw: item,
        playerName,
        minute: minute.display,
        sortValue: actionSortValue(item, index),
        key: actionKey(eventId, "injury", item, playerName),
      };
    })
    .filter(Boolean);
}

function getLiveActions(summary, event) {
  return [
    ...getGoals(summary, event),
    ...getCards(summary, event),
    ...getInjuries(summary, event),
  ].sort((a, b) => a.sortValue - b.sortValue);
}

function extractMarker(message) {
  for (const embed of message?.embeds || []) {
    const footer = String(embed?.footer?.text || "");

    for (const prefix of [MARKER_PREFIX, LEGACY_GOAL_MARKER_PREFIX]) {
      const index = footer.indexOf(prefix);
      if (index < 0) continue;
      const marker = footer.slice(index + prefix.length).trim().split(/\s+/)[0];
      if (marker) return marker;
    }
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

function hasSeenEvent(state, eventId) {
  const prefix = `${eventId}:`;
  return [...state.seen].some(key => String(key).startsWith(prefix));
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

function buildGoalPost(event, action, kickbaseIndex, discordManagerMap) {
  const teams = getMatchTeams(event);
  const scorerOwner = resolveKickbaseOwner(action.scorer, kickbaseIndex);
  const assistOwner = action.assist ? resolveKickbaseOwner(action.assist, kickbaseIndex) : null;
  const scorerTag = ownerTag(scorerOwner, discordManagerMap);
  const assistTag = ownerTag(assistOwner, discordManagerMap);
  const scorer = escapeDiscordText(action.scorer);
  const assist = action.assist ? escapeDiscordText(action.assist) : null;
  const flags = [action.penalty ? "Elfmeter" : null, action.ownGoal ? "Eigentor" : null].filter(Boolean);

  const description = [
    `## ⚽ **${action.score} durch ${scorer}**${scorerTag.text}`,
    assist ? `🎯 Vorlage: **${assist}**${assistTag.text}` : null,
    flags.length ? `ℹ️ ${flags.join(" • ")}` : null,
    "",
    `**${escapeDiscordText(teams.home.name)} ${action.score} ${escapeDiscordText(teams.away.name)}**`,
    `⏱️ **${action.minute}. Minute**`,
  ].filter(Boolean).join("\n");

  return {
    embed: buildKbbEmbed({
      title: "🚨 TOR IN DER BUNDESLIGA!",
      description,
      footer: `187 KICKBASEBANDE • LIVE • ${MARKER_PREFIX}${action.key}`,
    }),
    mentionUserIds: [...new Set([scorerTag.userId, assistTag.userId].filter(Boolean))],
  };
}

function buildCardPost(event, action, kickbaseIndex, discordManagerMap) {
  const teams = getMatchTeams(event);
  const owner = resolveKickbaseOwner(action.playerName, kickbaseIndex);
  const tag = ownerTag(owner, discordManagerMap);
  const player = escapeDiscordText(action.playerName);
  const cardLabel = action.cardKind === "yellow-red" ? "GELB-ROTE KARTE" : "ROTE KARTE";
  const title = action.cardKind === "yellow-red" ? "🟨🟥 GELB-ROT!" : "🟥 ROTE KARTE!";
  const livePoints = owner?.livePoints;

  const description = [
    `## ${action.cardKind === "yellow-red" ? "🟨🟥" : "🟥"} **${cardLabel} für ${player}**${tag.text}`,
    `💥 Kickbase-Kartenwertung: **${action.pointsPenalty} Punkte**`,
    Number.isFinite(livePoints) ? `📊 Aktuelle Kickbase-Livepunkte: **${livePoints}**` : null,
    "",
    `**${escapeDiscordText(teams.home.name)} vs. ${escapeDiscordText(teams.away.name)}**`,
    `⏱️ **${action.minute}. Minute**`,
  ].filter(Boolean).join("\n");

  return {
    embed: buildKbbEmbed({
      title,
      description,
      footer: `187 KICKBASEBANDE • LIVE • ${MARKER_PREFIX}${action.key}`,
    }),
    mentionUserIds: tag.userId ? [tag.userId] : [],
  };
}

function buildInjuryPost(event, action, kickbaseIndex, discordManagerMap) {
  const teams = getMatchTeams(event);
  const owner = resolveKickbaseOwner(action.playerName, kickbaseIndex);
  const tag = ownerTag(owner, discordManagerMap);
  const player = escapeDiscordText(action.playerName);

  const description = [
    `## 🚑 **${player}**${tag.text}`,
    "Der Spieler musste laut Live-Daten **verletzungsbedingt ausgewechselt** werden.",
    "",
    `**${escapeDiscordText(teams.home.name)} vs. ${escapeDiscordText(teams.away.name)}**`,
    `⏱️ **${action.minute}. Minute**`,
    "",
    "ℹ️ Art und Schwere der Verletzung werden nicht geraten und nur ergänzt, wenn eine verlässliche Quelle sie ausdrücklich nennt.",
  ].join("\n");

  return {
    embed: buildKbbEmbed({
      title: "🚑 VERLETZUNGSBEDINGTE AUSWECHSLUNG",
      description,
      footer: `187 KICKBASEBANDE • LIVE • ${MARKER_PREFIX}${action.key}`,
    }),
    mentionUserIds: tag.userId ? [tag.userId] : [],
  };
}

function buildPost(event, action, kickbaseIndex, discordManagerMap) {
  if (action.kind === "goal") return buildGoalPost(event, action, kickbaseIndex, discordManagerMap);
  if (action.kind === "card") return buildCardPost(event, action, kickbaseIndex, discordManagerMap);
  if (action.kind === "injury") return buildInjuryPost(event, action, kickbaseIndex, discordManagerMap);
  return null;
}

async function processGuild(guild) {
  if (runningGuilds.has(guild.id)) return;
  runningGuilds.add(guild.id);

  try {
    const channel = await guild.channels.fetch(GOAL_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) {
      console.warn(`⚠️ Bundesliga live-feed channel ${GOAL_CHANNEL_ID} unavailable in ${guild.id}`);
      return;
    }

    let state = guildStates.get(guild.id);
    if (!state) {
      state = { hydrated: false, seen: new Set() };
      guildStates.set(guild.id, state);
    }

    if (!state.hydrated) {
      state.seen = await hydrateSeen(channel, guild.client.user?.id);
      state.hydrated = true;
      console.log(`⚽ Bundesliga live-feed recovery ${guild.name}: ${state.seen.size} known marker(s)`);
    }

    const scoreboard = await fetchJson(scoreboardUrl());
    const events = Array.isArray(scoreboard?.events) ? scoreboard.events : [];
    if (!events.length) return;

    const pending = [];

    for (const event of events) {
      const eventId = String(event?.id || "").trim();
      if (!eventId) continue;

      const live = isLive(event);
      const completedRecovery = isCompleted(event) && hasSeenEvent(state, eventId);
      if (!live && !completedRecovery) continue;

      const summary = await fetchJson(summaryUrl(eventId)).catch(error => {
        console.warn(`⚠️ ESPN Bundesliga summary failed for ${eventId}: ${error?.message || error}`);
        return null;
      });
      if (!summary) continue;

      const actions = getLiveActions(summary, event);
      for (const action of actions) {
        if (!state.seen.has(action.key)) pending.push({ event, action });
      }
    }

    if (!pending.length) return;

    const [kickbaseLive, discordManagerMap] = await Promise.all([
      getKickbaseLiveOwnership(),
      buildDiscordManagerMap(guild),
    ]);

    const kickbaseIndex = buildKickbasePlayerIndex(kickbaseLive.ok ? kickbaseLive.players : []);
    if (!kickbaseLive.ok) {
      console.warn(`⚠️ Bundesliga live-feed Kickbase ownership unavailable: ${kickbaseLive.error || kickbaseLive.code}`);
    }

    pending.sort((a, b) => a.action.sortValue - b.action.sortValue);

    for (const { event, action } of pending) {
      if (state.seen.has(action.key)) continue;

      const post = buildPost(event, action, kickbaseIndex, discordManagerMap);
      if (!post) continue;

      const sent = await channel.send({
        embeds: [post.embed],
        allowedMentions: { users: post.mentionUserIds, parse: [] },
      }).catch(error => {
        console.error(`❌ Bundesliga live-feed post failed for ${guild.id}:`, error?.message || error);
        return null;
      });

      if (!sent) continue;
      state.seen.add(action.key);

      const teams = getMatchTeams(event);
      console.log(`✅ Bundesliga ${action.kind} posted: ${teams.home.name} vs ${teams.away.name} — ${action.playerName}`);
    }
  } catch (error) {
    console.error(`❌ Bundesliga live-feed poll failed for ${guild.id}:`, error?.message || error);
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

  setTimeout(() => run().catch(() => null), 15_000);
  console.log(`⚽ Bundesliga live feed ready: channel=${GOAL_CHANNEL_ID}, interval=${POLL_INTERVAL_MS}ms, goals+cards+injuries`);
  return setInterval(() => run().catch(() => null), POLL_INTERVAL_MS);
}
