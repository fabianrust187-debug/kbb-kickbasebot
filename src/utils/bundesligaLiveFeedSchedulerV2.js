import crypto from "crypto";
import { buildKbbEmbed } from "./embeds.js";
import { getManagers } from "./managerStore.js";
import { getKickbaseOwnershipSnapshot } from "./kickbaseLiveOwnership.js";
import { applyManagerAliases, normalizeManagerKey, resolveManagerAlias } from "./managerAliases.js";

const ESPN_LEAGUE = "ger.1";
const SCOREBOARD_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/scoreboard`;
const SUMMARY_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/summary`;
const GOAL_CHANNEL_ID = process.env.KBB_GOAL_CHANNEL_ID || "1522249187666952254";
const POLL_INTERVAL_MS = Math.max(20_000, Number(process.env.KBB_GOAL_FEED_INTERVAL_MS || 30_000));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.KBB_GOAL_FEED_TIMEOUT_MS || 10000));
const MARKER_PREFIX = "KBBLIVE2:";
const LEGACY_PREFIXES = ["KBBLIVE:", "KBBGOAL:"];
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

function scoreboardUrl() {
  const url = new URL(SCOREBOARD_BASE);
  url.searchParams.set("dates", berlinDateKey());
  return url.toString();
}

function summaryUrl(eventId) {
  const url = new URL(SUMMARY_BASE);
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

function participants(item) {
  if (Array.isArray(item?.participants)) return item.participants;
  if (Array.isArray(item?.athletesInvolved)) return item.athletesInvolved;
  return [];
}

function parseMinute(value) {
  const text = String(value || "");
  const match = text.match(/(\d+)(?:\D+\+\D*(\d+))?/);
  if (!match) return { minute: 999, added: 0, display: "?", valid: false };
  const minute = Number(match[1]);
  const added = Number(match[2] || 0);
  return { minute, added, display: added ? `${minute}+${added}` : String(minute), valid: true };
}

function sortValue(minute, period = 0, index = 0) {
  return Number(period || 0) * 100000 + minute.minute * 100 + minute.added + index / 1000;
}

function collectEntries(summary, event) {
  const sources = [
    ["keyEvents", summary?.keyEvents],
    ["header.details", summary?.header?.competitions?.[0]?.details],
    ["details", summary?.details],
    ["competition.details", getCompetition(event)?.details],
    ["commentary", summary?.commentary],
  ];

  const result = [];
  let index = 0;
  for (const [source, items] of sources) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      result.push({ item, source, index: index++ });
    }
  }
  return result;
}

function sourcePriority(source) {
  if (source === "keyEvents") return 5;
  if (source === "header.details") return 4;
  if (source === "details") return 3;
  if (source === "competition.details") return 2;
  return 1;
}

function entryQuality(entry) {
  const item = entry.item;
  const minute = parseMinute(item?.clock?.displayValue ?? item?.clock);
  let score = sourcePriority(entry.source) * 10;
  if (String(item?.id ?? item?.uid ?? item?.sequenceNumber ?? "").trim()) score += 2;
  if (participants(item).length) score += 5;
  if (minute.valid) score += 3;
  if (String(item?.team?.id ?? "").trim()) score += 2;
  if (asNumber(item?.homeScore) !== null && asNumber(item?.awayScore) !== null) score += 10;
  if (eventText(item)) score += 1;
  return score;
}

function oldActionKey(eventId, kind, item, playerName, extra = "") {
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

function stableActionKey(eventId, kind, identity) {
  const hash = crypto.createHash("sha1").update(`${eventId}|${kind}|${identity}`).digest("hex").slice(0, 20);
  return `${eventId}:${kind}:stable:${hash}`;
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

function goalPeople(item) {
  const list = participants(item);
  let scorer = list.find(participant => {
    const role = participantRole(participant);
    return (role.includes("scor") || role.includes("goal")) && !role.includes("assist");
  });
  if (!scorer) scorer = list.find(participant => Number(participant?.order) === 1) || list[0] || null;
  const assist = list.find(participant => participantRole(participant).includes("assist")) || null;
  const text = eventText(item);
  return {
    scorer: participantName(scorer) || parseScorerFromText(text) || "Unbekannter Torschütze",
    assist: participantName(assist) || parseAssistFromText(text),
  };
}

function uniqueGoals(summary, event) {
  const eventId = String(event?.id || "event");
  const groups = new Map();

  for (const entry of collectEntries(summary, event)) {
    const item = entry.item;
    if (item?.scoringPlay !== true || item?.shootout === true) continue;

    const people = goalPeople(item);
    const minute = parseMinute(item?.clock?.displayValue ?? item?.clock);
    const scorerKey = normalize(people.scorer);
    const homeScore = asNumber(item?.homeScore);
    const awayScore = asNumber(item?.awayScore);
    const teamId = String(item?.team?.id ?? "").trim() || null;
    const identity = minute.valid && scorerKey && scorerKey !== "unbekannter torschutze"
      ? `${minute.display}|${scorerKey}`
      : homeScore !== null && awayScore !== null
        ? `score:${homeScore}:${awayScore}|${scorerKey || teamId || "unknown"}`
        : `${minute.display}|${scorerKey || normalize(eventText(item))}`;

    const candidate = {
      entry,
      item,
      people,
      minute,
      homeScore,
      awayScore,
      teamId,
      ownGoal: item?.ownGoal === true || normalize(item?.type?.text).includes("own goal"),
      penalty: item?.penaltyKick === true || item?.penalty === true || normalize(item?.type?.text).includes("penalty"),
      quality: entryQuality(entry) + (people.assist ? 8 : 0),
      period: asNumber(item?.period?.number ?? item?.period) || 0,
      identity,
    };

    let group = groups.get(identity);
    if (!group) {
      group = {
        best: candidate,
        candidates: [],
        scorer: people.scorer,
        assist: people.assist || null,
        teamId,
        homeScore,
        awayScore,
        ownGoal: candidate.ownGoal,
        penalty: candidate.penalty,
        minute,
        period: candidate.period,
      };
      groups.set(identity, group);
    }

    group.candidates.push(candidate);
    if (candidate.quality > group.best.quality) group.best = candidate;
    if (!group.assist && people.assist) group.assist = people.assist;
    if (!group.teamId && teamId) group.teamId = teamId;
    group.ownGoal ||= candidate.ownGoal;
    group.penalty ||= candidate.penalty;

    if (homeScore !== null && awayScore !== null) {
      const oldTotal = group.homeScore !== null && group.awayScore !== null ? group.homeScore + group.awayScore : -1;
      const newTotal = homeScore + awayScore;
      if (newTotal >= oldTotal) {
        group.homeScore = homeScore;
        group.awayScore = awayScore;
      }
    }
  }

  const ordered = [...groups.values()].sort((a, b) =>
    sortValue(a.minute, a.period, a.best.entry.index) - sortValue(b.minute, b.period, b.best.entry.index));

  const teams = getTeams(event);
  let home = 0;
  let away = 0;

  return ordered.map(group => {
    if (group.homeScore !== null && group.awayScore !== null) {
      home = group.homeScore;
      away = group.awayScore;
    } else {
      let scoringTeamId = group.teamId;
      if (group.ownGoal && scoringTeamId) {
        if (scoringTeamId === teams.home.id) scoringTeamId = teams.away.id;
        else if (scoringTeamId === teams.away.id) scoringTeamId = teams.home.id;
      }
      if (scoringTeamId === teams.home.id) home += 1;
      else if (scoringTeamId === teams.away.id) away += 1;
    }

    const score = `${home}:${away}`;
    const stableKey = stableActionKey(eventId, "goal", group.identity);
    const legacyKeys = new Set();
    for (const candidate of group.candidates) {
      legacyKeys.add(oldActionKey(eventId, "goal", candidate.item, candidate.people.scorer, score));
      if (candidate.homeScore !== null && candidate.awayScore !== null) {
        legacyKeys.add(oldActionKey(eventId, "goal", candidate.item, candidate.people.scorer, `${candidate.homeScore}:${candidate.awayScore}`));
      }
    }

    return {
      kind: "goal",
      playerName: group.scorer,
      scorer: group.scorer,
      assist: group.assist,
      ownGoal: group.ownGoal,
      penalty: group.penalty,
      minute: group.minute.display,
      score,
      sortValue: sortValue(group.minute, group.period, group.best.entry.index),
      key: stableKey,
      legacyKeys: [...legacyKeys],
    };
  });
}

function detectCardKind(item) {
  const text = normalize(eventText(item));
  const type = normalize(item?.type?.text ?? item?.type?.displayName ?? item?.type?.name ?? "");
  if (item?.yellowRedCard === true || item?.secondYellow === true || text.includes("second yellow") || text.includes("yellow red") || text.includes("2nd yellow") || type.includes("second yellow") || type.includes("yellow red")) return "yellow-red";
  if (item?.redCard === true || text.includes("red card") || type.includes("red card")) return "red";
  return null;
}

function cardPlayer(item) {
  const list = participants(item);
  const preferred = list.find(participant => {
    const role = participantRole(participant);
    return role.includes("player") || role.includes("card") || role.includes("recipient");
  });
  const direct = participantName(preferred) || participantName(list[0]) || participantName(item?.athlete);
  if (direct) return direct;
  const text = String(eventText(item) || "");
  for (const pattern of [
    /^([^,.]+?)\s+\([^)]+\)\s+is shown the red card/i,
    /^([^,.]+?)\s+\([^)]+\)\s+is shown the second yellow card/i,
    /([^.;]+?)\s+is shown the red card/i,
    /([^.;]+?)\s+is shown the second yellow card/i,
  ]) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function uniqueCards(summary, event) {
  const eventId = String(event?.id || "event");
  const groups = new Map();

  for (const entry of collectEntries(summary, event)) {
    const cardKind = detectCardKind(entry.item);
    if (!cardKind) continue;
    const playerName = cardPlayer(entry.item);
    if (!playerName) continue;
    const minute = parseMinute(entry.item?.clock?.displayValue ?? entry.item?.clock);
    const identity = normalize(playerName) || normalize(eventText(entry.item));
    const candidate = {
      entry,
      item: entry.item,
      cardKind,
      playerName,
      minute,
      period: asNumber(entry.item?.period?.number ?? entry.item?.period) || 0,
      quality: entryQuality(entry) + (cardKind === "yellow-red" ? 4 : 0),
    };
    const existing = groups.get(identity);
    if (!existing || candidate.quality > existing.quality) groups.set(identity, candidate);
  }

  return [...groups.entries()].map(([identity, candidate]) => ({
    kind: "card",
    cardKind: candidate.cardKind,
    playerName: candidate.playerName,
    minute: candidate.minute.display,
    sortValue: sortValue(candidate.minute, candidate.period, candidate.entry.index),
    pointsPenalty: candidate.cardKind === "yellow-red" ? YELLOW_RED_POINTS : RED_CARD_POINTS,
    key: stableActionKey(eventId, "card", identity),
    legacyKeys: [
      oldActionKey(eventId, `card-${candidate.cardKind}`, candidate.item, candidate.playerName),
    ],
  }));
}

function isInjurySub(item) {
  const text = normalize(eventText(item));
  const type = normalize(item?.type?.text ?? item?.type?.displayName ?? item?.type?.name ?? "");
  const substitution = item?.substitution === true || type.includes("substitution") || text.startsWith("substitution");
  if (!substitution) return false;
  return ["injury", "injured", "due to injury", "following an injury", "unable to continue", "cannot continue", "forced off", "concussion", "medical", "verletz"]
    .some(signal => text.includes(signal));
}

function injuredPlayer(item) {
  const list = participants(item);
  const outgoing = list.find(participant => {
    const role = participantRole(participant);
    return role.includes("out") || role.includes("off") || role.includes("replaced");
  });
  const direct = participantName(outgoing);
  if (direct) return direct;
  const text = String(eventText(item) || "");
  for (const pattern of [
    /replaces\s+(.+?)\s+(?:because of|due to|following)\s+(?:an?\s+)?injury/i,
    /(.+?)\s+is replaced by\s+.+?\s+(?:because of|due to|following)\s+(?:an?\s+)?injury/i,
    /(.+?)\s+(?:is|was)\s+unable to continue/i,
    /(.+?)\s+(?:is|was)\s+forced off/i,
  ]) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  }
  return null;
}

function uniqueInjuries(summary, event) {
  const eventId = String(event?.id || "event");
  const groups = new Map();
  for (const entry of collectEntries(summary, event)) {
    if (!isInjurySub(entry.item)) continue;
    const playerName = injuredPlayer(entry.item);
    if (!playerName) continue;
    const minute = parseMinute(entry.item?.clock?.displayValue ?? entry.item?.clock);
    const identity = normalize(playerName) || normalize(eventText(entry.item));
    const candidate = {
      entry,
      item: entry.item,
      playerName,
      minute,
      period: asNumber(entry.item?.period?.number ?? entry.item?.period) || 0,
      quality: entryQuality(entry) + (minute.valid ? 6 : 0),
    };
    const existing = groups.get(identity);
    if (!existing || candidate.quality > existing.quality) groups.set(identity, candidate);
  }

  return [...groups.entries()].map(([identity, candidate]) => ({
    kind: "injury",
    playerName: candidate.playerName,
    minute: candidate.minute.display,
    sortValue: sortValue(candidate.minute, candidate.period, candidate.entry.index),
    key: stableActionKey(eventId, "injury", identity),
    legacyKeys: [oldActionKey(eventId, "injury", candidate.item, candidate.playerName)],
  }));
}

function liveActions(summary, event) {
  return [
    ...uniqueGoals(summary, event),
    ...uniqueCards(summary, event),
    ...uniqueInjuries(summary, event),
  ].sort((a, b) => a.sortValue - b.sortValue);
}

function extractMarkers(message) {
  const markers = [];
  for (const embed of message?.embeds || []) {
    const footer = String(embed?.footer?.text || "");
    for (const prefix of [MARKER_PREFIX, ...LEGACY_PREFIXES]) {
      const index = footer.indexOf(prefix);
      if (index < 0) continue;
      const marker = footer.slice(index + prefix.length).trim().split(/\s+/)[0];
      if (marker) markers.push(marker);
    }
  }
  return markers;
}

async function hydrateSeen(channel, botUserId) {
  const seen = new Set();
  const messages = await channel.messages.fetch({ limit: HISTORY_SCAN_LIMIT }).catch(() => null);
  if (!messages) return seen;
  for (const message of messages.values()) {
    if (message.author?.id !== botUserId) continue;
    for (const marker of extractMarkers(message)) seen.add(marker);
  }
  return seen;
}

function eventHasHistory(state, eventId) {
  const prefix = `${eventId}:`;
  return [...state.seen].some(key => String(key).startsWith(prefix));
}

function actionSeen(state, action) {
  if (state.seen.has(action.key)) return true;
  return (action.legacyKeys || []).some(key => state.seen.has(key));
}

function markActionSeen(state, action) {
  state.seen.add(action.key);
  for (const key of action.legacyKeys || []) state.seen.add(key);
}

function addUniqueMapValue(map, key, value) {
  if (!key) return;
  if (!map.has(key)) return map.set(key, value);
  const existing = map.get(key);
  if (!existing || existing.managerId !== value.managerId || existing.playerId !== value.playerId) map.set(key, null);
}

function buildPlayerIndex(players) {
  const exact = new Map();
  const surname = new Map();
  for (const player of players || []) {
    const key = normalize(player.playerName);
    if (!key) continue;
    addUniqueMapValue(exact, key, player);
    const parts = key.split(" ").filter(Boolean);
    if (parts.length) addUniqueMapValue(surname, parts[parts.length - 1], player);
  }
  return { exact, surname };
}

function resolveOwner(playerName, index) {
  const key = normalize(playerName);
  if (!key) return null;
  const exact = index.exact.get(key);
  if (exact) return exact;
  const parts = key.split(" ").filter(Boolean);
  return parts.length ? index.surname.get(parts[parts.length - 1]) || null : null;
}

async function buildDiscordManagerMap(guild) {
  const cached = discordManagerMapCache.get(guild.id);
  if (cached && cached.expiresAt > Date.now()) return cached.map;
  const map = new Map();

  for (const manager of getManagers(guild.id)) {
    const member = guild.members.cache.get(manager.userId)
      || await guild.members.fetch(manager.userId).catch(() => null);
    if (!member) continue;
    for (const name of [manager.username, member.displayName, member.nickname, member.user?.username, member.user?.globalName].filter(Boolean)) {
      const key = normalizeManagerKey(name);
      if (!key) continue;
      if (map.has(key) && map.get(key) !== manager.userId) map.set(key, null);
      else if (!map.has(key)) map.set(key, manager.userId);
    }
  }

  applyManagerAliases(map);
  discordManagerMapCache.set(guild.id, { map, expiresAt: Date.now() + 5 * 60_000 });
  return map;
}

function ownerTag(owner, managerMap) {
  if (!owner?.managerName) return { text: "", userId: null };
  const userId = managerMap.get(normalizeManagerKey(owner.managerName)) || resolveManagerAlias(owner.managerName);
  if (userId) return { text: ` (<@${userId}>)`, userId };
  return { text: ` (**${escapeDiscordText(owner.managerName)}**)`, userId: null };
}

function buildGoalPost(event, action, playerIndex, managerMap) {
  const teams = getTeams(event);
  const scorerOwner = resolveOwner(action.scorer, playerIndex);
  const assistOwner = action.assist ? resolveOwner(action.assist, playerIndex) : null;
  const scorerTag = ownerTag(scorerOwner, managerMap);
  const assistTag = ownerTag(assistOwner, managerMap);
  const flags = [action.penalty ? "Elfmeter" : null, action.ownGoal ? "Eigentor" : null].filter(Boolean);

  return {
    embed: buildKbbEmbed({
      title: "🚨 TOR IN DER BUNDESLIGA!",
      description: [
        `## ⚽ **${action.score} durch ${escapeDiscordText(action.scorer)}**${scorerTag.text}`,
        action.assist ? `🎯 Vorlage: **${escapeDiscordText(action.assist)}**${assistTag.text}` : null,
        flags.length ? `ℹ️ ${flags.join(" • ")}` : null,
        "",
        `**${escapeDiscordText(teams.home.name)} ${action.score} ${escapeDiscordText(teams.away.name)}**`,
        `⏱️ **${action.minute}. Minute**`,
      ].filter(Boolean).join("\n"),
      footer: `187 KICKBASEBANDE • LIVE • ${MARKER_PREFIX}${action.key}`,
    }),
    mentionUserIds: [...new Set([scorerTag.userId, assistTag.userId].filter(Boolean))],
  };
}

function buildCardPost(event, action, playerIndex, managerMap) {
  const teams = getTeams(event);
  const owner = resolveOwner(action.playerName, playerIndex);
  const tag = ownerTag(owner, managerMap);
  const yellowRed = action.cardKind === "yellow-red";
  return {
    embed: buildKbbEmbed({
      title: yellowRed ? "🟨🟥 GELB-ROT!" : "🟥 ROTE KARTE!",
      description: [
        `## ${yellowRed ? "🟨🟥" : "🟥"} **${yellowRed ? "GELB-ROTE KARTE" : "ROTE KARTE"} für ${escapeDiscordText(action.playerName)}**${tag.text}`,
        `💥 Kickbase-Kartenwertung: **${action.pointsPenalty} Punkte**`,
        Number.isFinite(owner?.livePoints) ? `📊 Aktuelle Kickbase-Livepunkte: **${owner.livePoints}**` : null,
        "",
        `**${escapeDiscordText(teams.home.name)} vs. ${escapeDiscordText(teams.away.name)}**`,
        `⏱️ **${action.minute}. Minute**`,
      ].filter(Boolean).join("\n"),
      footer: `187 KICKBASEBANDE • LIVE • ${MARKER_PREFIX}${action.key}`,
    }),
    mentionUserIds: tag.userId ? [tag.userId] : [],
  };
}

function buildInjuryPost(event, action, playerIndex, managerMap) {
  const teams = getTeams(event);
  const owner = resolveOwner(action.playerName, playerIndex);
  const tag = ownerTag(owner, managerMap);
  return {
    embed: buildKbbEmbed({
      title: "🚑 VERLETZUNGSBEDINGTE AUSWECHSLUNG",
      description: [
        `## 🚑 **${escapeDiscordText(action.playerName)}**${tag.text}`,
        "Der Spieler musste laut Live-Daten **verletzungsbedingt ausgewechselt** werden.",
        "",
        `**${escapeDiscordText(teams.home.name)} vs. ${escapeDiscordText(teams.away.name)}**`,
        `⏱️ **${action.minute}. Minute**`,
        "",
        "ℹ️ Art und Schwere der Verletzung werden nicht geraten.",
      ].join("\n"),
      footer: `187 KICKBASEBANDE • LIVE • ${MARKER_PREFIX}${action.key}`,
    }),
    mentionUserIds: tag.userId ? [tag.userId] : [],
  };
}

function buildPost(event, action, playerIndex, managerMap) {
  if (action.kind === "goal") return buildGoalPost(event, action, playerIndex, managerMap);
  if (action.kind === "card") return buildCardPost(event, action, playerIndex, managerMap);
  if (action.kind === "injury") return buildInjuryPost(event, action, playerIndex, managerMap);
  return null;
}

async function processGuild(guild) {
  if (runningGuilds.has(guild.id)) return;
  runningGuilds.add(guild.id);

  try {
    const channel = await guild.channels.fetch(GOAL_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) return;

    let state = guildStates.get(guild.id);
    if (!state) {
      state = { hydrated: false, seen: new Set(), initializedEvents: new Set() };
      guildStates.set(guild.id, state);
    }

    if (!state.hydrated) {
      state.seen = await hydrateSeen(channel, guild.client.user?.id);
      state.hydrated = true;
      console.log(`⚽ Bundesliga V2 recovery ${guild.name}: ${state.seen.size} marker(s)`);
    }

    const scoreboard = await fetchJson(scoreboardUrl());
    const events = Array.isArray(scoreboard?.events) ? scoreboard.events : [];
    const pending = [];

    for (const event of events) {
      const eventId = String(event?.id || "").trim();
      if (!eventId) continue;
      const live = isLive(event);
      const completedRecovery = isCompleted(event) && eventHasHistory(state, eventId);
      if (!live && !completedRecovery) continue;

      const summary = await fetchJson(summaryUrl(eventId)).catch(error => {
        console.warn(`⚠️ ESPN summary failed for ${eventId}: ${error?.message || error}`);
        return null;
      });
      if (!summary) continue;

      const actions = liveActions(summary, event);
      const firstObservation = !state.initializedEvents.has(eventId);
      state.initializedEvents.add(eventId);

      if (firstObservation && eventHasHistory(state, eventId)) {
        for (const action of actions) markActionSeen(state, action);
        console.log(`🛡️ Bundesliga V2 baselined ${actions.length} existing action(s) for ${eventId}`);
        continue;
      }

      for (const action of actions) {
        if (!actionSeen(state, action)) pending.push({ event, action });
      }
    }

    if (!pending.length) return;

    const [ownership, managerMap] = await Promise.all([
      getKickbaseOwnershipSnapshot(),
      buildDiscordManagerMap(guild),
    ]);
    const playerIndex = buildPlayerIndex(ownership.ok ? ownership.players : []);
    if (!ownership.ok) console.warn(`⚠️ Full Kickbase ownership unavailable: ${ownership.error || ownership.code}`);

    pending.sort((a, b) => a.action.sortValue - b.action.sortValue);

    for (const { event, action } of pending) {
      if (actionSeen(state, action)) continue;
      const post = buildPost(event, action, playerIndex, managerMap);
      if (!post) continue;

      const sent = await channel.send({
        embeds: [post.embed],
        allowedMentions: { users: post.mentionUserIds, parse: [] },
      }).catch(error => {
        console.error(`❌ Bundesliga V2 post failed: ${error?.message || error}`);
        return null;
      });

      if (!sent) continue;
      markActionSeen(state, action);
      console.log(`✅ Bundesliga V2 ${action.kind}: ${action.playerName}`);
    }
  } catch (error) {
    console.error(`❌ Bundesliga V2 poll failed for ${guild.id}:`, error?.message || error);
  } finally {
    runningGuilds.delete(guild.id);
  }
}

export function startBundesligaLiveFeedSchedulerV2(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      await processGuild(guild);
    }
  };

  setTimeout(() => run().catch(() => null), 8_000);
  console.log(`⚽ Bundesliga live feed V2 ready: channel=${GOAL_CHANNEL_ID}, interval=${POLL_INTERVAL_MS}ms`);
  return setInterval(() => run().catch(() => null), POLL_INTERVAL_MS);
}
