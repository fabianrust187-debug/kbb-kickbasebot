import crypto from "crypto";
import { buildKbbEmbed } from "./embeds.js";
import { getManagers } from "./managerStore.js";
import {
  findOwnerInOwnershipSnapshot,
  getReliableKickbaseOwnership,
} from "./kickbaseOwnershipReliable.js";
import {
  applyManagerAliases,
  normalizeManagerKey,
  resolveManagerAlias,
} from "./managerAliases.js";

const ESPN_LEAGUE = "ger.1";
const SCOREBOARD_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/scoreboard`;
const SUMMARY_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE}/summary`;
const CHANNEL_ID = process.env.KBB_GOAL_CHANNEL_ID || "1522249187666952254";
const POLL_MS = Math.max(20_000, Number(process.env.KBB_GOAL_FEED_INTERVAL_MS || 30_000));
const TIMEOUT_MS = Math.max(3_000, Number(process.env.KBB_GOAL_FEED_TIMEOUT_MS || 10_000));
const GOAL_SETTLE_MS = Math.max(15_000, Number(process.env.KBB_GOAL_SETTLE_MS || 30_000));
const MARKER = "KBBLIVE4:";
const OLD_MARKERS = ["KBBLIVE3:", "KBBLIVE2:", "KBBLIVE:", "KBBGOAL:"];
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanEventPlayerName(value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+with\s+(?:an?\s+)?(?:headed\s+)?(?:pass|cross|header|shot).*$/i, "")
    .replace(/\s+(?:after|following)\s+(?:an?\s+).+$/i, "")
    .replace(/\s+from\s+(?:an?\s+)?(?:headed\s+)?(?:pass|cross).*$/i, "")
    .trim();
}

function berlinDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
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
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
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
  const list = Array.isArray(competition(event)?.competitors) ? competition(event).competitors : [];
  const home = list.find(item => item?.homeAway === "home") || list[0] || null;
  const away = list.find(item => item?.homeAway === "away") || list[1] || null;
  const map = item => ({
    id: String(item?.id ?? item?.team?.id ?? "").trim() || null,
    name: String(item?.team?.displayName ?? item?.team?.shortDisplayName ?? item?.team?.name ?? "Unbekannt").trim(),
  });
  return { home: map(home), away: map(away) };
}

function isLive(event) {
  const type = event?.status?.type || {};
  return type.state === "in" && type.completed !== true;
}

function isCompleted(event) {
  const type = event?.status?.type || {};
  return type.completed === true || type.state === "post";
}

function minute(value) {
  const raw = String(value || "");
  const match = raw.match(/(\d+)(?:\D+\+\D*(\d+))?/);
  if (!match) return { base: 999, added: 0, display: "?", valid: false };
  const base = Number(match[1]);
  const added = Number(match[2] || 0);
  return { base, added, display: added ? `${base}+${added}` : String(base), valid: true };
}

function sortValue(actionMinute, period = 0, index = 0) {
  return Number(period || 0) * 100000 + actionMinute.base * 100 + actionMinute.added + index / 1000;
}

function itemText(item) {
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
  const result = [];
  for (const source of [item?.participants, item?.athletesInvolved, item?.athletes]) {
    if (Array.isArray(source)) result.push(...source);
  }
  return result;
}

function participantName(participant) {
  if (!participant) return "";
  return cleanEventPlayerName(
    participant?.athlete?.displayName
      ?? participant?.athlete?.fullName
      ?? participant?.athlete?.shortName
      ?? participant?.displayName
      ?? participant?.fullName
      ?? participant?.shortName
      ?? participant?.name
      ?? participant?.text
      ?? "",
  );
}

function participantRole(participant) {
  const type = participant?.type;
  return normalize(
    typeof type === "string"
      ? type
      : type?.text ?? type?.name ?? type?.displayName ?? type?.abbreviation ?? participant?.role ?? "",
  );
}

function allEntries(summary, event) {
  const sources = [
    ["scoringPlays", summary?.scoringPlays],
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
    for (const item of list) {
      if (item && typeof item === "object") result.push({ item, source, index: index++ });
    }
  }
  return result;
}

function sourceScore(source) {
  if (source === "scoringPlays") return 70;
  if (source === "keyEvents") return 60;
  if (source === "header") return 50;
  if (source === "details") return 40;
  if (source === "competition") return 30;
  return 20;
}

function entryScore(entry) {
  const item = entry.item;
  let score = sourceScore(entry.source);
  if (participants(item).length) score += 15;
  if (minute(item?.clock?.displayValue ?? item?.clock).valid) score += 5;
  if (String(item?.team?.id ?? "").trim()) score += 5;
  if (num(item?.homeScore) !== null && num(item?.awayScore) !== null) score += 20;
  return score;
}

function stableKey(eventId, kind, identity) {
  const hash = crypto.createHash("sha1")
    .update(`${eventId}|${kind}|${identity}`)
    .digest("hex")
    .slice(0, 20);
  return `${eventId}:${kind}:${hash}`;
}

function parseAssist(raw) {
  const text = String(raw || "");
  const patterns = [
    /assisted\s+by\s+([^.;]+)/i,
    /assist(?:ed)?\s*(?:by|:)\s*([^.;]+)/i,
    /vorlage\s*(?:von|:)\s*([^.;]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanEventPlayerName(match[1]);
  }
  return null;
}

function fieldAssist(item) {
  const candidates = [
    item?.assist,
    item?.assistedBy,
    item?.assistBy,
    Array.isArray(item?.assists) ? item.assists[0] : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const cleaned = cleanEventPlayerName(candidate);
      if (cleaned) return cleaned;
    }
    const name = participantName(candidate);
    if (name) return name;
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

  const assistParticipant = list.find(participant => participantRole(participant).includes("assist")) || null;
  const raw = itemText(item);
  let scorerName = participantName(scorer);
  if (!scorerName) {
    const match = raw.match(/^\s*([^,.]+?)\s+Goal/i);
    scorerName = cleanEventPlayerName(match?.[1] || "") || "Unbekannter Torschütze";
  }

  return {
    scorer: cleanEventPlayerName(scorerName),
    assist: participantName(assistParticipant) || fieldAssist(item) || parseAssist(raw),
  };
}

function goalActions(summary, event) {
  const eventId = String(event?.id || "event");
  const entries = allEntries(summary, event);
  const groups = new Map();

  for (const entry of entries) {
    const item = entry.item;
    const rawType = normalize(item?.type?.text ?? item?.type?.name ?? item?.type?.displayName ?? "");
    const rawText = normalize(itemText(item));
    const isGoal = item?.scoringPlay === true || rawType === "goal" || rawType.includes("goal scored");
    if (!isGoal || item?.shootout === true) continue;

    const people = goalPeople(item);
    const m = minute(item?.clock?.displayValue ?? item?.clock);
    const teamId = String(item?.team?.id ?? "").trim() || null;
    const scorerKey = normalize(people.scorer);
    const identity = `${m.display}|${scorerKey || teamId || rawText}`;
    const candidate = {
      entry,
      people,
      m,
      teamId,
      homeScore: num(item?.homeScore),
      awayScore: num(item?.awayScore),
      ownGoal: item?.ownGoal === true || rawType.includes("own goal"),
      penalty: item?.penaltyKick === true || item?.penalty === true || rawType.includes("penalty"),
      period: num(item?.period?.number ?? item?.period) || 0,
      quality: entryScore(entry) + (people.assist ? 20 : 0),
    };

    const existing = groups.get(identity);
    if (!existing) {
      groups.set(identity, candidate);
      continue;
    }

    const richer = candidate.quality > existing.quality ? candidate : existing;
    const poorer = richer === candidate ? existing : candidate;
    richer.people = {
      scorer: richer.people.scorer || poorer.people.scorer,
      assist: richer.people.assist || poorer.people.assist,
    };
    if (richer.homeScore === null && poorer.homeScore !== null) richer.homeScore = poorer.homeScore;
    if (richer.awayScore === null && poorer.awayScore !== null) richer.awayScore = poorer.awayScore;
    groups.set(identity, richer);
  }

  // ESPN commentary often contains the assist a few seconds later and is not itself
  // flagged as scoringPlay. Attach that richer commentary to the already known goal.
  for (const entry of entries) {
    const raw = itemText(entry.item);
    const assist = fieldAssist(entry.item) || parseAssist(raw);
    if (!assist) continue;
    const m = minute(entry.item?.clock?.displayValue ?? entry.item?.clock);
    const sameMinute = [...groups.values()].filter(group => group.m.display === m.display);
    if (sameMinute.length !== 1) continue;
    if (!sameMinute[0].people.assist) sameMinute[0].people.assist = assist;
  }

  const ordered = [...groups.entries()].sort((a, b) =>
    sortValue(a[1].m, a[1].period, a[1].entry.index)
      - sortValue(b[1].m, b[1].period, b[1].entry.index));

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
  const raw = normalize(itemText(item));
  const type = normalize(item?.type?.text ?? item?.type?.name ?? "");
  if (
    item?.yellowRedCard === true
    || item?.secondYellow === true
    || raw.includes("second yellow")
    || raw.includes("yellow red")
    || type.includes("second yellow")
  ) return "yellow-red";
  if (item?.redCard === true || raw.includes("red card") || type.includes("red card")) return "red";
  return null;
}

function cardPlayer(item) {
  const list = participants(item);
  const participant = list.find(value => /player|card|recipient/.test(participantRole(value))) || list[0] || item?.athlete;
  const direct = participantName(participant);
  if (direct) return direct;
  const raw = itemText(item);
  const match = raw.match(/^([^,.]+?)\s+\([^)]+\)\s+is shown the (?:red|second yellow) card/i)
    || raw.match(/([^.;]+?)\s+is shown the (?:red|second yellow) card/i);
  return cleanEventPlayerName(match?.[1] || "") || null;
}

function cardActions(summary, event) {
  const eventId = String(event?.id || "event");
  const groups = new Map();
  for (const entry of allEntries(summary, event)) {
    const kind = cardKind(entry.item);
    if (!kind) continue;
    const playerName = cardPlayer(entry.item);
    if (!playerName) continue;
    const m = minute(entry.item?.clock?.displayValue ?? entry.item?.clock);
    const identity = `${kind}|${normalize(playerName)}|${m.display}`;
    const candidate = {
      entry,
      kind,
      playerName,
      m,
      period: num(entry.item?.period?.number ?? entry.item?.period) || 0,
      quality: entryScore(entry),
    };
    const old = groups.get(identity);
    if (!old || candidate.quality > old.quality) groups.set(identity, candidate);
  }

  return [...groups.entries()].map(([identity, candidate]) => ({
    kind: "card",
    cardKind: candidate.kind,
    playerName: candidate.playerName,
    minute: candidate.m.display,
    pointsPenalty: candidate.kind === "yellow-red" ? YELLOW_RED_POINTS : RED_POINTS,
    key: stableKey(eventId, "card", identity),
    sort: sortValue(candidate.m, candidate.period, candidate.entry.index),
  }));
}

function injurySub(item) {
  const raw = normalize(itemText(item));
  const type = normalize(item?.type?.text ?? item?.type?.name ?? "");
  const substitution = item?.substitution === true || type.includes("substitution") || raw.startsWith("substitution");
  return substitution && [
    "injury",
    "injured",
    "unable to continue",
    "cannot continue",
    "forced off",
    "concussion",
    "medical",
    "verletz",
  ].some(signal => raw.includes(signal));
}

function injuredPlayer(item) {
  const list = participants(item);
  const outgoing = list.find(participant => /out|off|replaced/.test(participantRole(participant)));
  const direct = participantName(outgoing);
  if (direct) return direct;
  const raw = itemText(item);
  for (const pattern of [
    /replaces\s+(.+?)\s+(?:because of|due to|following)\s+(?:an?\s+)?injury/i,
    /(.+?)\s+(?:is|was)\s+(?:unable to continue|forced off)/i,
  ]) {
    const match = raw.match(pattern);
    if (match?.[1]) return cleanEventPlayerName(match[1]);
  }
  return null;
}

function injuryActions(summary, event) {
  const eventId = String(event?.id || "event");
  const groups = new Map();
  for (const entry of allEntries(summary, event)) {
    if (!injurySub(entry.item)) continue;
    const playerName = injuredPlayer(entry.item);
    if (!playerName) continue;
    const m = minute(entry.item?.clock?.displayValue ?? entry.item?.clock);
    const identity = `${normalize(playerName)}|${m.display}`;
    const candidate = {
      entry,
      playerName,
      m,
      period: num(entry.item?.period?.number ?? entry.item?.period) || 0,
      quality: entryScore(entry) + (m.valid ? 10 : 0),
    };
    const old = groups.get(identity);
    if (!old || candidate.quality > old.quality) groups.set(identity, candidate);
  }

  return [...groups.entries()].map(([identity, candidate]) => ({
    kind: "injury",
    playerName: candidate.playerName,
    minute: candidate.m.display,
    key: stableKey(eventId, "injury", identity),
    sort: sortValue(candidate.m, candidate.period, candidate.entry.index),
  }));
}

function actions(summary, event) {
  return [
    ...goalActions(summary, event),
    ...cardActions(summary, event),
    ...injuryActions(summary, event),
  ].sort((a, b) => a.sort - b.sort);
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

async function discordManagerMap(guild) {
  const cached = managerMapCache.get(guild.id);
  if (cached && cached.expiresAt > Date.now()) return cached.map;

  const map = new Map();
  for (const manager of getManagers(guild.id)) {
    const member = guild.members.cache.get(manager.userId)
      || await guild.members.fetch(manager.userId).catch(() => null);
    if (!member) continue;

    for (const name of [
      manager.username,
      member.displayName,
      member.nickname,
      member.user?.username,
      member.user?.globalName,
    ].filter(Boolean)) {
      const key = normalizeManagerKey(name);
      if (!key) continue;
      if (map.has(key) && map.get(key) !== manager.userId) map.set(key, null);
      else if (!map.has(key)) map.set(key, manager.userId);
    }
  }

  applyManagerAliases(map);
  managerMapCache.set(guild.id, { map, expiresAt: Date.now() + 5 * 60_000 });
  return map;
}

function ownerTag(playerOwner, managerMap) {
  if (!playerOwner?.managerName) return { text: "", userId: null };
  const userId = managerMap.get(normalizeManagerKey(playerOwner.managerName))
    || resolveManagerAlias(playerOwner.managerName);
  return userId
    ? { text: ` (<@${userId}>)`, userId }
    : { text: ` (**${escapeDiscord(playerOwner.managerName)}**)`, userId: null };
}

function buildPost(event, action, ownership, managerMap) {
  const match = teams(event);
  const playerOwner = findOwnerInOwnershipSnapshot(action.playerName, ownership);
  const tag = ownerTag(playerOwner, managerMap);

  if (action.kind === "goal") {
    const assistOwner = action.assist
      ? findOwnerInOwnershipSnapshot(action.assist, ownership)
      : null;
    const assistTag = ownerTag(assistOwner, managerMap);
    const flags = [
      action.penalty ? "Elfmeter" : null,
      action.ownGoal ? "Eigentor" : null,
    ].filter(Boolean);

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
      playerOwner,
      assistOwner,
    };
  }

  if (action.kind === "card") {
    const yellowRed = action.cardKind === "yellow-red";
    return {
      embed: buildKbbEmbed({
        title: yellowRed ? "🟨🟥 GELB-ROT!" : "🟥 ROTE KARTE!",
        description: [
          `## ${yellowRed ? "🟨🟥" : "🟥"} **${yellowRed ? "GELB-ROTE KARTE" : "ROTE KARTE"} für ${escapeDiscord(action.playerName)}**${tag.text}`,
          `💥 Kickbase-Kartenwertung: **${action.pointsPenalty} Punkte**`,
          Number.isFinite(playerOwner?.livePoints)
            ? `📊 Aktuelle Kickbase-Livepunkte: **${playerOwner.livePoints}**`
            : null,
          "",
          `**${escapeDiscord(match.home.name)} vs. ${escapeDiscord(match.away.name)}**`,
          `⏱️ **${action.minute}. Minute**`,
        ].filter(Boolean).join("\n"),
        footer: `187 KICKBASEBANDE • LIVE • ${MARKER}${action.key}`,
      }),
      mentions: tag.userId ? [tag.userId] : [],
      playerOwner,
      assistOwner: null,
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
    playerOwner,
    assistOwner: null,
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
      state = {
        hydrated: false,
        seen: new Set(),
        initializedEvents: new Set(),
        pendingGoals: new Map(),
      };
      states.set(guild.id, state);
    }

    if (!state.hydrated) {
      state.seen = await hydrate(channel, guild.client.user?.id);
      state.hydrated = true;
      console.log(`⚽ Bundesliga V4 recovery: ${state.seen.size} marker(s)`);
    }

    const board = await fetchJson(scoreboardUrl());
    const games = Array.isArray(board?.events) ? board.events : [];
    const ready = [];

    for (const event of games) {
      const eventId = String(event?.id || "").trim();
      if (!eventId) continue;
      if (!isLive(event) && !(isCompleted(event) && state.initializedEvents.has(eventId))) continue;

      const summary = await fetchJson(summaryUrl(eventId)).catch(error => {
        console.warn(`⚠️ Bundesliga V4 summary ${eventId}: ${error?.message || error}`);
        return null;
      });
      if (!summary) continue;

      const current = actions(summary, event);
      const firstObservation = !state.initializedEvents.has(eventId);
      state.initializedEvents.add(eventId);

      // Deploy/restart baseline: never repost events that already existed when this
      // process first observed a currently running match.
      if (firstObservation) {
        for (const action of current) state.seen.add(action.key);
        console.log(`🛡️ Bundesliga V4 baseline ${eventId}: ${current.length} existing event(s)`);
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
            state.pendingGoals.set(action.key, {
              firstSeenAt: Date.now(),
              event,
              action,
            });
            continue;
          }

          pending.event = event;
          // Every poll can enrich the same goal with score and assist information.
          pending.action = {
            ...pending.action,
            ...action,
            assist: action.assist || pending.action.assist || null,
          };

          const settled = Date.now() - pending.firstSeenAt >= GOAL_SETTLE_MS || isCompleted(event);
          if (settled) ready.push({ event: pending.event, action: pending.action });
          continue;
        }

        ready.push({ event, action });
      }
    }

    if (!ready.length) return;

    const [ownership, managerMap] = await Promise.all([
      getReliableKickbaseOwnership(),
      discordManagerMap(guild),
    ]);
    if (!ownership.ok) {
      console.warn(`⚠️ Kickbase ownership unavailable: ${ownership.error || ownership.code}`);
    }

    ready.sort((a, b) => a.action.sort - b.action.sort);
    for (const { event, action } of ready) {
      if (state.seen.has(action.key)) continue;

      const post = buildPost(event, action, ownership, managerMap);
      const sent = await channel.send({
        embeds: [post.embed],
        allowedMentions: { users: post.mentions, parse: [] },
      }).catch(error => {
        console.error(`❌ Bundesliga V4 post failed: ${error?.message || error}`);
        return null;
      });
      if (!sent) continue;

      state.seen.add(action.key);
      state.pendingGoals.delete(action.key);
      console.log([
        `✅ Bundesliga V4 ${action.kind}: ${action.playerName}`,
        `owner=${post.playerOwner?.managerName || "none"}`,
        action.kind === "goal" ? `assist=${action.assist || "none"}` : null,
        action.kind === "goal" ? `assistOwner=${post.assistOwner?.managerName || "none"}` : null,
      ].filter(Boolean).join(" "));
    }
  } catch (error) {
    console.error(`❌ Bundesliga V4 poll failed for ${guild.id}:`, error?.message || error);
  } finally {
    runningGuilds.delete(guild.id);
  }
}

export function startBundesligaLiveFeedSchedulerV4(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) await processGuild(guild);
  };

  setTimeout(() => run().catch(() => null), 8_000);
  console.log(`⚽ Bundesliga live feed V4 ready: channel=${CHANNEL_ID}, interval=${POLL_MS}ms, goal-settle=${GOAL_SETTLE_MS}ms`);
  return setInterval(() => run().catch(() => null), POLL_MS);
}
