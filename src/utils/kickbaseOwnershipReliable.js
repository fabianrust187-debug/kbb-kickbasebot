const API_BASE = "https://api.kickbase.com/v4";
const DEFAULT_LEAGUE_NAME = process.env.KICKBASE_LEAGUE_NAME || "187 KICKBASEBANDE";
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.KICKBASE_API_TIMEOUT_MS || 10000));
const CACHE_MS = Math.max(30000, Number(process.env.KBB_OWNERSHIP_CACHE_MS || 60000));

let cachedToken = String(process.env.KICKBASE_TOKEN || "").trim() || null;
let cachedLeagueId = String(process.env.KICKBASE_LEAGUE_ID || "").trim() || null;
let snapshotCache = { expiresAt: 0, value: null };

function normalize(value) {
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
  const data = await apiGet("/leagues");
  const leagues = Array.isArray(data?.it) ? data.it : Array.isArray(data) ? data : [];
  const wanted = normalize(DEFAULT_LEAGUE_NAME);
  const match = leagues.find(item => normalize(item?.n ?? item?.name) === wanted);
  cachedLeagueId = String(match?.i ?? match?.id ?? "").trim() || null;
  return cachedLeagueId;
}

function parseRanking(data) {
  const entries = Array.isArray(data?.us) ? data.us
    : Array.isArray(data?.u) ? data.u
      : Array.isArray(data?.it) ? data.it
        : Array.isArray(data) ? data : [];

  const map = new Map();
  for (const entry of entries) {
    const nested = entry?.u && typeof entry.u === "object" ? entry.u : null;
    const managerId = String(entry?.i ?? entry?.id ?? nested?.i ?? "").trim();
    const managerName = String(entry?.n ?? entry?.name ?? entry?.unm ?? nested?.n ?? nested?.unm ?? "").trim();
    if (managerId) map.set(managerId, { managerId, managerName: managerName || "Unbekannter Manager" });
  }
  return [...map.values()];
}

function playerName(player) {
  const first = String(player?.fn ?? player?.firstName ?? "").trim();
  const last = String(player?.ln ?? player?.lastName ?? "").trim();
  const n = String(player?.n ?? player?.name ?? player?.displayName ?? "").trim();
  if (first && last) return `${first} ${last}`;
  if (first && n && !normalize(n).startsWith(normalize(first))) return `${first} ${n}`;
  return n || first;
}

function parsePlayers(data, manager, { live = false } = {}) {
  const list = Array.isArray(data?.lp) ? data.lp
    : Array.isArray(data?.pl) ? data.pl
      : Array.isArray(data?.players) ? data.players
        : Array.isArray(data?.it) ? data.it
          : Array.isArray(data) ? data : [];

  return list.map(player => {
    const id = String(player?.i ?? player?.id ?? player?.pi ?? "").trim() || null;
    const name = playerName(player) || id;
    if (!name) return null;
    return {
      playerId: id,
      playerName: name,
      normalizedName: normalize(name),
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
      managerId: String(user?.id ?? user?.i ?? user?.u?.i ?? "").trim() || null,
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
  const keyOf = player => player.playerId ? `id:${player.playerId}` : `name:${normalize(player.playerName)}`;
  for (const player of squadPlayers) map.set(keyOf(player), player);
  for (const player of livePlayers) {
    const key = keyOf(player);
    map.set(key, { ...(map.get(key) || {}), ...player, live: true });
  }
  return [...map.values()];
}

async function loadManagerSquad(leagueId, manager) {
  const paths = [
    `/leagues/${leagueId}/managers/${manager.managerId}/squad`,
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
    } catch (error) {
      console.warn(`⚠️ Kickbase ownership fallback failed ${path}: ${error?.message || error}`);
    }
  }
  return [];
}

export async function getReliableKickbaseOwnership({ force = false } = {}) {
  if (!force && snapshotCache.value && snapshotCache.expiresAt > Date.now()) return snapshotCache.value;

  try {
    const leagueId = await resolveLeagueId();
    if (!leagueId) return { ok: false, code: "LEAGUE_NOT_FOUND", error: "Kickbase-Liga konnte nicht gefunden werden." };

    let live = { managers: [], players: [] };
    try { live = parseLive(await apiGet(`/leagues/${leagueId}/live`)); } catch (error) {
      console.warn(`⚠️ Kickbase live ownership unavailable: ${error?.message || error}`);
    }

    let managers = [];
    try { managers = parseRanking(await apiGet(`/leagues/${leagueId}/ranking`)); } catch (error) {
      console.warn(`⚠️ Kickbase ranking unavailable: ${error?.message || error}`);
    }

    if (!managers.length) managers = live.managers;
    const byId = new Map(managers.map(manager => [manager.managerId, manager]));
    for (const manager of live.managers) if (!byId.has(manager.managerId)) byId.set(manager.managerId, manager);
    managers = [...byId.values()];

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
    console.log(`👤 Kickbase ownership snapshot: managers=${managers.length}, squads=${squadPlayers.length}, live=${live.players.length}`);
    return value;
  } catch (error) {
    return { ok: false, code: "API_ERROR", error: error?.message || "Kickbase-Besitzerdaten konnten nicht geladen werden." };
  }
}
