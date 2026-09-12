const API_BASE = "https://api.kickbase.com/v4";
const DEFAULT_LEAGUE_NAME = process.env.KICKBASE_LEAGUE_NAME || "187 KICKBASEBANDE";
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.KICKBASE_API_TIMEOUT_MS || 10000));
const CACHE_MS = Math.max(30000, Number(process.env.KBB_OWNERSHIP_CACHE_MS || 60000));

let cachedToken = String(process.env.KICKBASE_TOKEN || "").trim() || null;
let cachedLeagueId = String(process.env.KICKBASE_LEAGUE_ID || "").trim() || null;
let snapshotCache = { expiresAt: 0, value: null };

export function normalizeKickbasePlayerName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
    let data = null;
    try { data = await response.json(); } catch {}
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function login() {
  const email = String(process.env.KICKBASE_EMAIL || "").trim();
  const password = String(process.env.KICKBASE_PASSWORD || "");
  if (!email || !password) return null;

  const { response, data } = await fetchJson(`${API_BASE}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ em: email, loy: false, pass: password, rep: {} }),
  });
  if (!response.ok || !data?.tkn) throw new Error(`Kickbase login failed (${response.status}).`);
  cachedToken = String(data.tkn);
  return cachedToken;
}

async function getToken(force = false) {
  if (!force && cachedToken) return cachedToken;
  if (process.env.KICKBASE_EMAIL && process.env.KICKBASE_PASSWORD) return login();
  cachedToken = String(process.env.KICKBASE_TOKEN || "").trim() || null;
  return cachedToken;
}

async function apiGet(path) {
  let token = await getToken();
  if (!token) throw new Error("Kickbase API credentials are not configured.");

  const request = authToken => fetchJson(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  let result = await request(token);
  if (result.response.status === 401 && process.env.KICKBASE_EMAIL && process.env.KICKBASE_PASSWORD) {
    cachedToken = null;
    token = await getToken(true);
    result = await request(token);
  }
  if (!result.response.ok) throw new Error(`Kickbase API request failed (${result.response.status}) for ${path}.`);
  return result.data;
}

async function resolveLeagueId() {
  if (cachedLeagueId) return cachedLeagueId;

  const configured = String(process.env.KICKBASE_LEAGUE_ID || "").trim();
  if (configured) {
    cachedLeagueId = configured;
    return cachedLeagueId;
  }

  for (const path of ["/leagues", "/leagues/selection"]) {
    try {
      const data = await apiGet(path);
      const leagues = Array.isArray(data?.it) ? data.it : Array.isArray(data) ? data : [];
      const wanted = normalizeKickbasePlayerName(DEFAULT_LEAGUE_NAME);
      const match = leagues.find(item => normalizeKickbasePlayerName(item?.n ?? item?.name) === wanted);
      if (match) {
        cachedLeagueId = String(match.i ?? match.id ?? "").trim() || null;
        if (cachedLeagueId) return cachedLeagueId;
      }
    } catch (error) {
      console.warn(`⚠️ Kickbase league discovery failed ${path}: ${error?.message || error}`);
    }
  }
  return null;
}

function managerEntries(data) {
  if (!data || typeof data !== "object") return [];
  const arrays = [data.us, data.u, data.managers, data.it, data.m];
  return arrays.find(Array.isArray) || (Array.isArray(data) ? data : []);
}

function parseManagers(data) {
  const map = new Map();
  for (const entry of managerEntries(data)) {
    if (!entry || typeof entry !== "object") continue;
    const nested = entry.u && typeof entry.u === "object" ? entry.u : null;
    const managerId = String(
      entry.i ?? entry.id ?? entry.ui ?? entry.uid ?? entry.userId ?? entry.managerId
      ?? nested?.i ?? nested?.id ?? "",
    ).trim();
    const managerName = String(
      entry.n ?? entry.name ?? entry.unm ?? entry.username ?? entry.managerName
      ?? nested?.n ?? nested?.name ?? nested?.unm ?? "",
    ).trim();
    if (!managerId) continue;
    map.set(managerId, { managerId, managerName: managerName || "Unbekannter Manager" });
  }
  return [...map.values()];
}

function mergeManagers(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const manager of list || []) {
      if (!manager?.managerId) continue;
      const existing = map.get(manager.managerId);
      if (!existing || existing.managerName === "Unbekannter Manager") map.set(manager.managerId, manager);
    }
  }
  return [...map.values()];
}

function playerName(player) {
  const first = String(player?.fn ?? player?.firstName ?? "").trim();
  const last = String(player?.ln ?? player?.lastName ?? "").trim();
  const n = String(player?.n ?? player?.name ?? player?.displayName ?? player?.fullName ?? "").trim();
  if (first && last) return `${first} ${last}`;
  if (first && n && !normalizeKickbasePlayerName(n).startsWith(normalizeKickbasePlayerName(first))) return `${first} ${n}`;
  return n || first;
}

function looksLikePlayer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const id = value.i ?? value.id ?? value.pi ?? value.playerId;
  const hasName = value.fn !== undefined || value.ln !== undefined || value.n !== undefined
    || value.name !== undefined || value.displayName !== undefined;
  const playerSignals = value.tid !== undefined || value.teamId !== undefined || value.mv !== undefined
    || value.st !== undefined || value.pos !== undefined || value.p !== undefined || value.t !== undefined;
  return Boolean(id && hasName && playerSignals);
}

function extractPlayerList(data, depth = 0) {
  if (!data || depth > 3) return [];
  if (Array.isArray(data)) {
    if (data.some(looksLikePlayer)) return data.filter(item => item && typeof item === "object");
    return [];
  }
  if (typeof data !== "object") return [];

  const preferredKeys = ["lp", "pl", "players", "it", "p", "squad"];
  for (const key of preferredKeys) {
    if (!(key in data)) continue;
    const found = extractPlayerList(data[key], depth + 1);
    if (found.length) return found;
  }

  for (const value of Object.values(data)) {
    if (!value || typeof value !== "object") continue;
    const found = extractPlayerList(value, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function parsePlayers(data, manager, { live = false } = {}) {
  return extractPlayerList(data).map(player => {
    const id = String(player?.i ?? player?.id ?? player?.pi ?? player?.playerId ?? "").trim() || null;
    const name = playerName(player) || id;
    if (!name) return null;
    return {
      playerId: id,
      playerName: name,
      normalizedName: normalizeKickbasePlayerName(name),
      teamId: String(player?.tid ?? player?.teamId ?? "").trim() || null,
      livePoints: numberOrNull(player?.t ?? player?.p ?? player?.points ?? player?.livePoints),
      managerId: manager.managerId,
      managerName: manager.managerName,
      live,
    };
  }).filter(Boolean);
}

function parseLive(data) {
  const users = Array.isArray(data?.u) ? data.u : Array.isArray(data?.us) ? data.us : [];
  const managers = [];
  const players = [];
  for (const user of users) {
    const manager = {
      managerId: String(user?.id ?? user?.i ?? user?.ui ?? user?.u?.i ?? "").trim() || null,
      managerName: String(user?.n ?? user?.name ?? user?.unm ?? user?.u?.n ?? "").trim() || "Unbekannter Manager",
    };
    if (!manager.managerId) continue;
    managers.push(manager);
    players.push(...parsePlayers(user, manager, { live: true }));
  }
  return { managers, players };
}

function mergePlayers(squadPlayers, livePlayers) {
  const map = new Map();
  const keyOf = player => player.playerId ? `id:${player.playerId}` : `name:${normalizeKickbasePlayerName(player.playerName)}`;
  for (const player of squadPlayers) map.set(keyOf(player), player);
  for (const player of livePlayers) {
    const key = keyOf(player);
    map.set(key, { ...(map.get(key) || {}), ...player, live: true });
  }
  return [...map.values()];
}

async function loadManagerDirectory(leagueId, liveManagers) {
  const sources = [liveManagers];
  for (const path of [
    `/leagues/${leagueId}/overview?includeManagersAndBattles=true`,
    `/leagues/${leagueId}/ranking`,
    `/leagues/${leagueId}/settings/managers`,
  ]) {
    try {
      const parsed = parseManagers(await apiGet(path));
      console.log(`👤 Kickbase manager source ${path}: ${parsed.length} manager(s)`);
      sources.push(parsed);
    } catch (error) {
      console.warn(`⚠️ Kickbase manager source failed ${path}: ${error?.message || error}`);
    }
  }
  return mergeManagers(...sources);
}

async function loadManagerSquad(leagueId, manager) {
  const paths = [
    `/leagues/${leagueId}/managers/${manager.managerId}/squad`,
    `/leagues/${leagueId}/managers/${manager.managerId}/players`,
    `/leagues/${leagueId}/users/${manager.managerId}/teamcenter`,
    `/leagues/${leagueId}/users/${manager.managerId}/players`,
  ];

  for (const path of paths) {
    try {
      const data = await apiGet(path);
      const players = parsePlayers(data, manager);
      if (players.length) {
        console.log(`👥 Kickbase squad ${manager.managerName}: ${players.length} player(s) via ${path}`);
        return players;
      }
      console.warn(`⚠️ Kickbase squad ${manager.managerName}: response from ${path} contained no recognized player list`);
    } catch (error) {
      console.warn(`⚠️ Kickbase ownership fallback failed ${path}: ${error?.message || error}`);
    }
  }
  return [];
}

function sameManager(matches) {
  if (!matches.length) return null;
  const managerIds = new Set(matches.map(player => String(player.managerId || "")).filter(Boolean));
  if (managerIds.size !== 1) return null;

  const preferred = matches.find(player => player.live) || matches.find(player => player.playerId) || matches[0];
  return preferred || null;
}

export function findOwnerInOwnershipSnapshot(playerNameToFind, snapshot) {
  if (!snapshot?.ok || !Array.isArray(snapshot.players)) return null;
  const wanted = normalizeKickbasePlayerName(playerNameToFind);
  if (!wanted) return null;

  const exact = snapshot.players.filter(player => normalizeKickbasePlayerName(player.playerName) === wanted);
  if (exact.length) return sameManager(exact);

  const wantedParts = wanted.split(" ").filter(Boolean);
  const surname = wantedParts.at(-1);
  if (!surname) return null;

  const surnameMatches = snapshot.players.filter(player => {
    const parts = normalizeKickbasePlayerName(player.playerName).split(" ").filter(Boolean);
    return parts.at(-1) === surname;
  });
  if (surnameMatches.length) return sameManager(surnameMatches);

  // Some Kickbase payloads expose only the surname while ESPN uses the full name.
  // As a final safe fallback, accept contained-name matches only when every hit
  // still belongs to the same manager.
  const contained = snapshot.players.filter(player => {
    const key = normalizeKickbasePlayerName(player.playerName);
    if (!key) return false;
    return key.includes(wanted) || wanted.includes(key);
  });
  return sameManager(contained);
}

export function findSimilarOwnershipPlayers(playerNameToFind, snapshot, limit = 8) {
  if (!snapshot?.ok || !Array.isArray(snapshot.players)) return [];
  const wanted = normalizeKickbasePlayerName(playerNameToFind);
  if (!wanted) return [];
  const tokens = wanted.split(" ").filter(Boolean);
  return snapshot.players
    .map(player => {
      const key = normalizeKickbasePlayerName(player.playerName);
      let score = key === wanted ? 100 : 0;
      for (const token of tokens) if (key.includes(token)) score += 10;
      if (key.includes(wanted) || wanted.includes(key)) score += 20;
      return { player, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.player);
}

export async function getReliableKickbaseOwnership({ force = false } = {}) {
  if (!force && snapshotCache.value && snapshotCache.expiresAt > Date.now()) return snapshotCache.value;

  try {
    const leagueId = await resolveLeagueId();
    if (!leagueId) return { ok: false, code: "LEAGUE_NOT_FOUND", error: "Kickbase-Liga konnte nicht gefunden werden." };

    let live = { managers: [], players: [] };
    try {
      live = parseLive(await apiGet(`/leagues/${leagueId}/live`));
      console.log(`📊 Kickbase live source: managers=${live.managers.length}, players=${live.players.length}`);
    } catch (error) {
      console.warn(`⚠️ Kickbase live ownership unavailable: ${error?.message || error}`);
    }

    const managers = await loadManagerDirectory(leagueId, live.managers);
    const squadLists = await Promise.all(managers.map(manager => loadManagerSquad(leagueId, manager)));
    const squadPlayers = squadLists.flat();
    const players = mergePlayers(squadPlayers, live.players);

    const value = {
      ok: true,
      leagueId,
      leagueName: DEFAULT_LEAGUE_NAME,
      managers,
      players,
      livePlayerCount: live.players.length,
      squadPlayerCount: squadPlayers.length,
      fetchedAt: new Date().toISOString(),
    };
    snapshotCache = { value, expiresAt: Date.now() + CACHE_MS };
    console.log(`👤 Kickbase ownership snapshot: managers=${managers.length}, squads=${squadPlayers.length}, live=${live.players.length}, merged=${players.length}`);
    return value;
  } catch (error) {
    return { ok: false, code: "API_ERROR", error: error?.message || "Kickbase-Besitzerdaten konnten nicht geladen werden." };
  }
}
