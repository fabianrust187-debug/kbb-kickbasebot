import crypto from "crypto";
import { buildKbbEmbed } from "./embeds.js";
import { getManagers } from "./managerStore.js";
import { getReliableKickbaseOwnership } from "./kickbaseOwnershipReliable.js";
import { applyManagerAliases, normalizeManagerKey, resolveManagerAlias } from "./managerAliases.js";

const ESPN_LEAGUE = "ger.1";
const SCOREBOARD_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/scoreboard`;
const SUMMARY_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/summary`;
const CHANNEL_ID = process.env.KBB_GOAL_CHANNEL_ID || "1522249187666952254";
const POLL_MS = Math.max(20000, Number(process.env.KBB_GOAL_FEED_INTERVAL_MS || 30000));
const TIMEOUT_MS = Math.max(3000, Number(process.env.KBB_GOAL_FEED_TIMEOUT_MS || 10000));
const GOAL_SETTLE_MS = Math.max(10000, Number(process.env.KBB_GOAL_SETTLE_MS || 20000));
const MARKER = "KBBLIVE3:";
const OLD_MARKERS = ["KBBLIVE2:", "KBBLIVE:", "KBBGOAL:"];
const RED_POINTS = -75;
const YELLOW_RED_POINTS = -50;
const HISTORY_SCAN_LIMIT = 100;

const states = new Map();
const runningGuilds = new Set();
const managerMapCache = new Map();

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeDiscord(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/([*_~`>|])/g, "\\$1");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function berlinDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}${p.month}${p.day}`;
}

function scoreboardUrl() {
  const url = new URL(SCOREBOARD_BASE);
  url.searchParams.set("dates", berlinDate());
  return url.toString();
}

function summaryUrl(eventId) {
  const url = new URL(SUMMARY_BASE);
  url.searchParams.set("event", String(eventId));
  return url.toString();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function competition(event) {
  return Array.isArray(event?.competitions) ? event.competitions[0] || null : null;
}

function teams(event) {
  const entries = Array.isArray(competition(event)?.competitors) ? competition(event).competitors : [];
  const home = entries.find(item => item?.homeAway === "home") || entries[0] || null;
  const away = entries.find(item => item?.homeAway === "away") || entries[1] || null;
  const map = item => ({
    id: String(item?.id ?? item?.team?.id ?? "").trim() || null,
    name: String(item?.team?.displayName ?? item?.team?.shortDisplayName ?? item?.team?.name ?? "Unbekannt").trim(),
  });
  return { home: map(home), away: map(away) };
}

function live(event) {
  const type = event?.status?.type || {};
  return type.state === "in" && type.completed !== true;
}

function completed(event) {
  const type = event?.status?.type || {};
  return type.completed === true || type.state === "post";
}

function minute(value) {
  const text = String(value || "");
  const match = text.match(/(\d+)(?:\D+\+\D*(\d+))?/);
  if (!match) return { base: 999, added: 0, display: "?", valid: false };
  const base = Number(match[1]);
  const added = Number(match[2] || 0);
  return { base, added, display: added ? `${base}+${added}` : String(base), valid: true };
}

function sortValue(actionMinute, period = 0, index = 0) {
  return Number(period || 0) * 100000 + actionMinute.base * 100 + actionMinute.added + index / 1000;
}

function text(item) {
  return [item?.shortText, item?.text, item?.description, item?.type?.text, item?.type?.displayName, item?.type?.name]
    .filter(Boolean).join(" ").trim();
}

function participants(item) {
  if (Array.isArray(item?.participants)) return item.participants;
  if (Array.isArray(item?.athletesInvolved)) return item.athletesInvolved;
  return [];
}

function participantName(participant) {
  return String(
    participant?.athlete?.displayName ?? participant?.athlete?.fullName ?? participant?.athlete?.shortName
    ?? participant?.displayName ?? participant?.fullName ?? participant?.shortName ?? participant?.name ?? "",
  ).trim();
}

function participantRole(participant) {
  const type = participant?.type;
  return normalize(typeof type === "string" ? type : type?.text ?? type?.name ?? type?.displayName ?? type?.abbreviation ?? "");
}

function entries(summary, event) {
  const sources = [
    ["keyEvents", summary?.keyEvents],
    ["header", summary?.header?.competitions?.[0]?.details],
    ["details", summary?.details],
    ["competition", competition(event)?.details],
    ["commentary", summary?.commentary],
  ];
  const result = [];
  let index = 0;
  for (const [source, list] of sources) {
    if (!Array.isArray(list)) continue;
    for (const item of list) if (item && typeof item === "object") result.push({ item, source, index: index++ });
  }
  return result;
}

function sourceScore(source) {
  return source === "keyEvents" ? 50 : source === "header" ? 40 : source === "details" ? 30 : source === "competition" ? 20 : 10;
}

function entryScore(entry) {
  const item = entry.item;
  let score = sourceScore(entry.source);
  if (participants(item).length) score += 10;
  if (minute(item?.clock?.displayValue ?? item?.clock).valid) score += 5;
  if (String(item?.team?.id ?? "").trim()) score += 4;
  if (num(item?.homeScore) !== null && num(item?.awayScore) !== null) score += 20;
  if (String(item?.id ?? item?.uid ?? item?.sequenceNumber ?? "").trim()) score += 3;
  return score;
}

function stableKey(eventId, kind, identity) {
  const hash = crypto.createHash("sha1").update(`${eventId}|${kind}|${identity}`).digest("hex").slice(0, 20);
  return `${eventId}:${kind}:${hash}`;
}

function parseAssist(raw) {
  for (const pattern of [/assisted\s+by\s+([^.;]+)/i, /assist(?:ed)?\s*:\s*([^.;]+)/i, /vorlage\s*(?:von|:)\s*([^.;]+)/i]) {
    const match = String(raw || "").match(pattern);
    if (match?.[1]) return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  }
  return null;
}

function goalPeople(item) {
  const list = participants(item);
  let scorer = list.find(p => {
    const role = participantRole(p);
    return (role.includes("scor") || role.includes("goal")) && !role.includes("assist");
  });
  if (!scorer) scorer = list.find(p => Number(p?.order) === 1) || list[0] || null;
  const assist = list.find(p => participantRole(p).includes("assist")) || null;
  const raw = text(item);
  let scorerName = participantName(scorer);
  if (!scorerName) {
    const match = raw.match(/^\s*([^,.]+?)\s+Goal/i);
    scorerName = match?.[1]?.trim() || "Unbekannter Torschütze";
  }
  return { scorer: scorerName, assist: participantName(assist) || parseAssist(raw) };
}

function goalActions(summary, event) {
  const eventId = String(event?.id || "event");
  const groups = new Map();

  for (const entry of entries(summary, event)) {
    const item = entry.item;
    if (item?.scoringPlay !== true || item?.shootout === true) continue;
    const people = goalPeople(item);
    const m = minute(item?.clock?.displayValue ?? item?.clock);
    const teamId = String(item?.team?.id ?? "").trim() || null;
    const scorerKey = normalize(people.scorer);
    const identity = `${m.display}|${scorerKey || teamId || normalize(text(item))}`;
    const candidate = {
      entry, item, people, m, teamId,
      homeScore: num(item?.homeScore), awayScore: num(item?.awayScore),
      ownGoal: item?.ownGoal === true || normalize(item?.type?.text).includes("own goal"),
      penalty: item?.penaltyKick === true || item?.penalty === true || normalize(item?.type?.text).includes("penalty"),
      period: num(item?.period?.number ?? item?.period) || 0,
      quality: entryScore(entry) + (people.assist ? 15 : 0),
    };

    let group = groups.get(identity);
    if (!group) {
      group = { ...candidate, candidates: [candidate] };
      groups.set(identity, group);
      continue;
    }
    group.candidates.push(candidate);
    if (candidate.quality > group.quality) {
      const existingAssist = group.people?.assist;
      group = { ...candidate, candidates: group.candidates, people: { ...candidate.people, assist: candidate.people.assist || existingAssist } };
      groups.set(identity, group);
    } else if (!group.people.assist && candidate.people.assist) {
      group.people.assist = candidate.people.assist;
    }
    if (group.homeScore === null && candidate.homeScore !== null) group.homeScore = candidate.homeScore;
    if (group.awayScore === null && candidate.awayScore !== null) group.awayScore = candidate.awayScore;
  }

  const ordered = [...groups.entries()].sort((a, b) =>
    sortValue(a[1].m, a[1].period, a[1].entry.index) - sortValue(b[1].m, b[1].period, b[1].entry.index));
  const matchTeams = teams(event);
  let home = 0;
  let away = 0;

  return ordered.map(([identity, group]) => {
    if (group.homeScore !== null && group.awayScore !== null) {
      home = group.homeScore;
      away = group.awayScore;
    } else {
      let scoringTeam = group.teamId;
      if (group.ownGoal && scoringTeam) {
        if (scoringTeam === matchTeams.home.id) scoringTeam = matchTeams.away.id;
        else if (scoringTeam === matchTeams.away.id) scoringTeam = matchTeams.home.id;
      }
      if (scoringTeam === matchTeams.home.id) home += 1;
      else if (scoringTeam === matchTeams.away.id) away += 1;
    }
    return {
      kind: "goal",
      playerName: group.people.scorer,
      scorer: group.people.scorer,
      assist: group.people.assist || null,
      score: `${home}:${away}`,
      minute: group.m.display,
      ownGoal: group.ownGoal,
      penalty: group.penalty,
      key: stableKey(eventId, "goal", identity),
      sort: sortValue(group.m, group.period, group.entry.index),
    };
  });
}

function cardKind(item) {
  const raw = normalize(text(item));
  const type = normalize(item?.type?.text ?? item?.type?.name ?? "");
  if (item?.yellowRedCard === true || item?.secondYellow === true || raw.includes("second yellow") || raw.includes("yellow red") || type.includes("second yellow")) return "yellow-red";
  if (item?.redCard === true || raw.includes("red card") || type.includes("red card")) return "red";
  return null;
}

function cardPlayer(item) {
  const list = participants(item);
  const p = list.find(x => /player|card|recipient/.test(participantRole(x))) || list[0] || item?.athlete;
  const direct = participantName(p);
  if (direct) return direct;
  const raw = text(item);
  const match = raw.match(/^([^,.]+?)\s+\([^)]+\)\s+is shown the (?:red|second yellow) card/i)
    || raw.match(/([^.;]+?)\s+is shown the (?:red|second yellow) card/i);
  return match?.[1]?.trim() || null;
}

function cardActions(summary, event) {
  const eventId = String(event?.id || "event");
  const groups = new Map();
  for (const entry of entries(summary, event)) {
    const kind = cardKind(entry.item);
    if (!kind) continue;
    const playerName = cardPlayer(entry.item);
    if (!playerName) continue;
    const id = normalize(playerName);
    const m = minute(entry.item?.clock?.displayValue ?? entry.item?.clock);
    const candidate = { entry, kind, playerName, m, quality: entryScore(entry) + (kind === "yellow-red" ? 4 : 0), period: num(entry.item?.period?.number ?? entry.item?.period) || 0 };
    const old = groups.get(id);
    if (!old || candidate.quality > old.quality) groups.set(id, candidate);
  }
  return [...groups.entries()].map(([identity, c]) => ({
    kind: "card", cardKind: c.kind, playerName: c.playerName, minute: c.m.display,
    pointsPenalty: c.kind === "yellow-red" ? YELLOW_RED_POINTS : RED_POINTS,
    key: stableKey(eventId, "card", identity), sort: sortValue(c.m, c.period, c.entry.index),
  }));
}

function injurySub(item) {
  const raw = normalize(text(item));
  const type = normalize(item?.type?.text ?? item?.type?.name ?? "");
  const sub = item?.substitution === true || type.includes("substitution") || raw.startsWith("substitution");
  return sub && ["injury", "injured", "unable to continue", "cannot continue", "forced off", "concussion", "medical", "verletz"]
    .some(signal => raw.includes(signal));
}

function injuredPlayer(item) {
  const list = participants(item);
  const outgoing = list.find(p => /out|off|replaced/.test(participantRole(p)));
  const direct = participantName(outgoing);
  if (direct) return direct;
  const raw = text(item);
  for (const pattern of [/replaces\s+(.+?)\s+(?:because of|due to|following)\s+(?:an?\s+)?injury/i, /(.+?)\s+(?:is|was)\s+(?:unable to continue|forced off)/i]) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  }
  return null;
}

function injuryActions(summary, event) {
  const eventId = String(event?.id || "event");
  const groups = new Map();
  for (const entry of entries(summary, event)) {
    if (!injurySub(entry.item)) continue;
    const playerName = injuredPlayer(entry.item);
    if (!playerName) continue;
    const id = normalize(playerName);
    const m = minute(entry.item?.clock?.displayValue ?? entry.item?.clock);
    const candidate = { entry, playerName, m, quality: entryScore(entry) + (m.valid ? 10 : 0), period: num(entry.item?.period?.number ?? entry.item?.period) || 0 };
    const old = groups.get(id);
    if (!old || candidate.quality > old.quality) groups.set(id, candidate);
  }
  return [...groups.entries()].map(([identity, c]) => ({
    kind: "injury", playerName: c.playerName, minute: c.m.display,
    key: stableKey(eventId, "injury", identity), sort: sortValue(c.m, c.period, c.entry.index),
  }));
}

function actions(summary, event) {
  return [...goalActions(summary, event), ...cardActions(summary, event), ...injuryActions(summary, event)]
    .sort((a, b) => a.sort - b.sort);
}

async function hydrate(channel, botId) {
  const seen = new Set();
  const messages = await channel.messages.fetch({ limit: HISTORY_SCAN_LIMIT }).catch(() => null);
  if (!messages) return seen;
  for (const message of messages.values()) {
    if (message.author?.id !== botId) continue;
    for (const embed of message.embeds || []) {
      const footer = String(embed?.footer?.text || "");
      for (const prefix of [MARKER, ...OLD_MARKERS]) {
        const pos = footer.indexOf(prefix);
        if (pos < 0) continue;
        const value = footer.slice(pos + prefix.length).trim().split(/\s+/)[0];
        if (value) seen.add(value);
      }
    }
  }
  return seen;
}

function buildPlayerIndex(players) {
  const exact = new Map();
  const surname = new Map();
  const add = (map, key, value) => {
    if (!key) return;
    if (!map.has(key)) return map.set(key, value);
    const old = map.get(key);
    if (!old || old.managerId !== value.managerId || old.playerId !== value.playerId) map.set(key, null);
  };
  for (const player of players || []) {
    const key = normalize(player.playerName);
    add(exact, key, player);
    const parts = key.split(" ").filter(Boolean);
    if (parts.length) add(surname, parts.at(-1), player);
  }
  return { exact, surname };
}

function owner(playerName, index) {
  const key = normalize(playerName);
  if (!key) return null;
  const exact = index.exact.get(key);
  if (exact) return exact;
  const parts = key.split(" ").filter(Boolean);
  return parts.length ? index.surname.get(parts.at(-1)) || null : null;
}

async function discordManagerMap(guild) {
  const cached = managerMapCache.get(guild.id);
  if (cached && cached.expiresAt > Date.now()) return cached.map;
  const map = new Map();
  for (const manager of getManagers(guild.id)) {
    const member = guild.members.cache.get(manager.userId) || await guild.members.fetch(manager.userId).catch(() => null);
    if (!member) continue;
    for (const name of [manager.username, member.displayName, member.nickname, member.user?.username, member.user?.globalName].filter(Boolean)) {
      const key = normalizeManagerKey(name);
      if (!key) continue;
      if (map.has(key) && map.get(key) !== manager.userId) map.set(key, null);
      else if (!map.has(key)) map.set(key, manager.userId);
    }
  }
  applyManagerAliases(map);
  managerMapCache.set(guild.id, { map, expiresAt: Date.now() + 5 * 60000 });
  return map;
}

function ownerTag(playerOwner, map) {
  if (!playerOwner?.managerName) return { text: "", userId: null };
  const userId = map.get(normalizeManagerKey(playerOwner.managerName)) || resolveManagerAlias(playerOwner.managerName);
  return userId
    ? { text: ` (<@${userId}>)`, userId }
    : { text: ` (**${escapeDiscord(playerOwner.managerName)}**)`, userId: null };
}

function postFor(event, action, playerIndex, managerMap) {
  const match = teams(event);
  const playerOwner = owner(action.playerName, playerIndex);
  const tag = ownerTag(playerOwner, managerMap);

  if (action.kind === "goal") {
    const assistOwner = action.assist ? owner(action.assist, playerIndex) : null;
    const assistTag = ownerTag(assistOwner, managerMap);
    const flags = [action.penalty ? "Elfmeter" : null, action.ownGoal ? "Eigentor" : null].filter(Boolean);
    return {
      embed: buildKbbEmbed({
        title: "🚨 TOR IN DER BUNDESLIGA!",
        description: [
          `## ⚽ **${action.score} durch ${escapeDiscord(action.scorer)}**${tag.text}`,
          action.assist ? `🎯 Vorlage: **${escapeDiscord(action.assist)}**${assistTag.text}` : null,
          flags.length ? `ℹ️ ${flags.join(" • ")}` : null,
          "",
          `**${escapeDiscord(match.home.name)} ${action.score} ${escapeDiscord(match.away.name)}**`,
          `⏱️ **${action.minute}. Minute**`,
        ].filter(Boolean).join("\n"),
        footer: `187 KICKBASEBANDE • LIVE • ${MARKER}${action.key}`,
      }),
      mentions: [...new Set([tag.userId, assistTag.userId].filter(Boolean))],
    };
  }

  if (action.kind === "card") {
    const yr = action.cardKind === "yellow-red";
    return {
      embed: buildKbbEmbed({
        title: yr ? "🟨🟥 GELB-ROT!" : "🟥 ROTE KARTE!",
        description: [
          `## ${yr ? "🟨🟥" : "🟥"} **${yr ? "GELB-ROTE KARTE" : "ROTE KARTE"} für ${escapeDiscord(action.playerName)}**${tag.text}`,
          `💥 Kickbase-Kartenwertung: **${action.pointsPenalty} Punkte**`,
          Number.isFinite(playerOwner?.livePoints) ? `📊 Aktuelle Kickbase-Livepunkte: **${playerOwner.livePoints}**` : null,
          "",
          `**${escapeDiscord(match.home.name)} vs. ${escapeDiscord(match.away.name)}**`,
          `⏱️ **${action.minute}. Minute**`,
        ].filter(Boolean).join("\n"),
        footer: `187 KICKBASEBANDE • LIVE • ${MARKER}${action.key}`,
      }),
      mentions: tag.userId ? [tag.userId] : [],
    };
  }

  return {
    embed: buildKbbEmbed({
      title: "🚑 VERLETZUNGSBEDINGTE AUSWECHSLUNG",
      description: [
        `## 🚑 **${escapeDiscord(action.playerName)}**${tag.text}`,
        "Der Spieler musste laut Live-Daten **verletzungsbedingt ausgewechselt** werden.",
        "",
        `**${escapeDiscord(match.home.name)} vs. ${escapeDiscord(match.away.name)}**`,
        `⏱️ **${action.minute}. Minute**`,
        "",
        "ℹ️ Art und Schwere der Verletzung werden nicht geraten.",
      ].join("\n"),
      footer: `187 KICKBASEBANDE • LIVE • ${MARKER}${action.key}`,
    }),
    mentions: tag.userId ? [tag.userId] : [],
  };
}

async function processGuild(guild) {
  if (runningGuilds.has(guild.id)) return;
  runningGuilds.add(guild.id);
  try {
    const channel = await guild.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) return;

    let state = states.get(guild.id);
    if (!state) {
      state = { hydrated: false, seen: new Set(), initializedEvents: new Set(), pendingGoals: new Map() };
      states.set(guild.id, state);
    }
    if (!state.hydrated) {
      state.seen = await hydrate(channel, guild.client.user?.id);
      state.hydrated = true;
      console.log(`⚽ Bundesliga V3 recovery: ${state.seen.size} marker(s)`);
    }

    const board = await fetchJson(scoreboardUrl());
    const games = Array.isArray(board?.events) ? board.events : [];
    const ready = [];

    for (const event of games) {
      const eventId = String(event?.id || "").trim();
      if (!eventId) continue;
      if (!live(event) && !(completed(event) && state.initializedEvents.has(eventId))) continue;

      const summary = await fetchJson(summaryUrl(eventId)).catch(error => {
        console.warn(`⚠️ Bundesliga summary ${eventId}: ${error?.message || error}`);
        return null;
      });
      if (!summary) continue;

      const current = actions(summary, event);
      const firstObservation = !state.initializedEvents.has(eventId);
      state.initializedEvents.add(eventId);

      // On every bot start/redeploy, current match events become the baseline. Never backfill old events.
      if (firstObservation) {
        for (const action of current) state.seen.add(action.key);
        console.log(`🛡️ Bundesliga V3 baseline ${eventId}: ${current.length} existing event(s)`);
        continue;
      }

      for (const action of current) {
        if (state.seen.has(action.key)) {
          state.pendingGoals.delete(action.key);
          continue;
        }

        if (action.kind === "goal") {
          const pending = state.pendingGoals.get(action.key);
          if (!pending) {
            state.pendingGoals.set(action.key, { firstSeenAt: Date.now(), event, action });
            continue;
          }
          pending.event = event;
          pending.action = action; // newest poll contains the richest scorer/assist/score data
          const settled = Date.now() - pending.firstSeenAt >= GOAL_SETTLE_MS || completed(event);
          if (settled) ready.push({ event: pending.event, action: pending.action });
          continue;
        }

        ready.push({ event, action });
      }
    }

    if (!ready.length) return;
    const [ownership, managers] = await Promise.all([getReliableKickbaseOwnership(), discordManagerMap(guild)]);
    const index = buildPlayerIndex(ownership.ok ? ownership.players : []);
    if (!ownership.ok) console.warn(`⚠️ Kickbase ownership unavailable: ${ownership.error || ownership.code}`);

    ready.sort((a, b) => a.action.sort - b.action.sort);
    for (const { event, action } of ready) {
      if (state.seen.has(action.key)) continue;
      const post = postFor(event, action, index, managers);
      const sent = await channel.send({ embeds: [post.embed], allowedMentions: { users: post.mentions, parse: [] } }).catch(error => {
        console.error(`❌ Bundesliga V3 post failed: ${error?.message || error}`);
        return null;
      });
      if (!sent) continue;
      state.seen.add(action.key);
      state.pendingGoals.delete(action.key);
      const resolved = owner(action.playerName, index);
      console.log(`✅ Bundesliga V3 ${action.kind}: ${action.playerName} owner=${resolved?.managerName || "none"}`);
    }
  } catch (error) {
    console.error(`❌ Bundesliga V3 poll failed for ${guild.id}:`, error?.message || error);
  } finally {
    runningGuilds.delete(guild.id);
  }
}

export function startBundesligaLiveFeedSchedulerV3(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) await processGuild(guild);
  };
  setTimeout(() => run().catch(() => null), 8000);
  console.log(`⚽ Bundesliga live feed V3 ready: channel=${CHANNEL_ID}, interval=${POLL_MS}ms, goal-settle=${GOAL_SETTLE_MS}ms`);
  return setInterval(() => run().catch(() => null), POLL_MS);
}
