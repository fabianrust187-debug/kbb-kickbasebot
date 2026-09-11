const API_BASE = "https://api.kickbase.com/v4";
const DEFAULT_LEAGUE_NAME = process.env.KICKBASE_LEAGUE_NAME || "187 KICKBASEBANDE";
const REQUEST_TIMEOUT_MS = Number(process.env.KICKBASE_API_TIMEOUT_MS || 10000);
const OWNERSHIP_CACHE_MS = Math.max(30_000, Number(process.env.KBB_OWNERSHIP_CACHE_MS || 60_000));

let cachedToken = String(process.env.KICKBASE_TOKEN || "").trim() || null;
let cachedLeagueId = String(process.env.KICKBASE_LEAGUE_ID || "").trim() || null;
let ownershipCache = { expiresAt: 0, value: null };

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
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

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

  if (!response.ok || !data?.tkn) {
    const error = new Error(`Kickbase login failed (${response.status}).`);
    error.code = "AUTH_FAILED";
    throw error;
  }

  cachedToken = String(data.tkn);
  return cachedToken;
}

async function getToken(forceLogin = false) {
  if (!forceLogin && cachedToken) return cachedToken;

  const email = String(process.env.KICKBASE_EMAIL || "").trim();
  const password = String(process.env.KICKBASE_PASSWORD || "");
  if (email && password) return login();

  if (!forceLogin) {
    cachedToken = String(process.env.KICKBASE_TOKEN || "").trim() || null;
    return cachedToken;
  }

  return null;
}

async function apiGet(path) {
  let token = await getToken();
  if (!token) {
    const error = new Error("Kickbase API credentials are not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }

  const request = async authToken => fetchJson(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  let result = await request(token);
  if (result.response.status === 401 && process.env.KICKBASE_EMAIL && process.env.KICKBASE_PASSWORD) {
    cachedToken = null;
    token = await getToken(true);
    if (token) result = await request(token);
  }

  if (!result.response.ok) {
    const error = new Error(`Kickbase API request failed (${result.response.status}) for ${path}.`);
    error.status = result.response.status;
    error.code = result.response.status === 401 ? "AUTH_FAILED" : "API_ERROR";
    throw error;
  }

  return result.data;
}

async function resolveLeagueId() {
  if (cachedLeagueId) return cachedLeagueId;

  const configured = String(process.env.KICKBASE_LEAGUE_ID || "").trim();
  if (configured) {
    cachedLeagueId = configured;
    return cachedLeagueId;
  }

  const data = await apiGet("/leagues");
  const leagues = Array.isArray(data?.it)
    ? data.it
    : Array.isArray(data?.leagues)
      ? data.leagues
      : Array.isArray(data)
        ? data
        : [];

  const wanted = normalize(DEFAULT_LEAGUE_NAME);
  const match = leagues.find(entry => normalize(entry?.n ?? entry?.name) === wanted);
  cachedLeagueId = match ? String(match.i ?? match.id ?? "").trim() || null : null;
  return cachedLeagueId;
}

function parseUsers(data) {
  if (Array.isArray(data?.u)) return data.u;
  if (Array.isArray(data?.users)) return data.users;
  if (Array.isArray(data?.it)) return data.it;
  if (Array.isArray(data?.us)) return data.us;
  if (Array.isArray(data)) return data;
  return [];
}

function parseManager(entry) {
  if (!entry || typeof entry !== "object") return null;
  const nested = entry.u && typeof entry.u === "object" ? entry.u : null;
  const managerId = String(
    entry.managerId
    ?? entry.mi
    ?? entry.id
    ?? entry.i
    ?? nested?.i
    ?? (typeof entry.u === "string" ? entry.u : ""),
  ).trim() || null;
  const managerName = String(
    entry.managerName
    ?? entry.unm
    ?? entry.name
    ?? entry.n
    ?? nested?.unm
    ?? nested?.n
    ?? "",
  ).trim() || "Unbekannter Manager";
  if (!managerId) return null;
  return { managerId, managerName };
}

function parseManagerDirectory(data) {
  const candidates = [
    ...(Array.isArray(data) ? data : []),
    ...(Array.isArray(data?.it) ? data.it : []),
    ...(Array.isArray(data?.u) ? data.u : []),
    ...(Array.isArray(data?.us) ? data.us : []),
    ...(Array.isArray(data?.managers) ? data.managers : []),
    ...(Array.isArray(data?.m) ? data.m : []),
    ...(Array.isArray(data?.settings?.managers) ? data.settings.managers : []),
  ];

  const managers = new Map();
  for (const entry of candidates) {
    const parsed = parseManager(entry);
    if (!parsed) continue;
    const existing = managers.get(parsed.managerId);
    if (!existing || existing.managerName === "Unbekannter Manager") {
      managers.set(parsed.managerId, parsed);
    }
  }
  return [...managers.values()];
}

function playerDisplayName(player) {
  const firstName = String(player?.fn ?? player?.firstName ?? "").trim();
  const lastName = String(player?.ln ?? player?.lastName ?? "").trim();
  const shortName = String(player?.n ?? "").trim();
  const explicitName = String(player?.name ?? player?.displayName ?? player?.fullName ?? "").trim();

  if (firstName && lastName) return `${firstName} ${lastName}`.trim();
  if (explicitName) return explicitName;
  if (firstName && shortName) {
    const nf = normalize(firstName);
    const nn = normalize(shortName);
    return nn.startsWith(nf) ? shortName : `${firstName} ${shortName}`.trim();
  }
  return shortName || firstName;
}

function parsePlayer(player, manager, { live = false } = {}) {
  if (!player || typeof player !== "object") return null;

  const playerId = String(player.id ?? player.i ?? player.pi ?? "").trim() || null;
  const playerName = playerDisplayName(player) || playerId;
  if (!playerName) return null;

  return {
    playerId,
    playerName,
    normalizedName: normalize(playerName),
    teamId: String(player.tid ?? player.teamId ?? "").trim() || null,
    livePoints: numberOrNull(player.t ?? player.points ?? player.livePoints),
    goals: numberOrNull(player.g ?? player.goals),
    assists: numberOrNull(player.a ?? player.assists),
    redCards: numberOrNull(player.r ?? player.redCards),
    yellowCards: numberOrNull(player.y ?? player.yellowCards),
    yellowRedCards: numberOrNull(player.yr ?? player.yellowRedCards),
    managerId: manager.managerId,
    managerName: manager.managerName,
    live,
  };
}

function parsePlayerList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.pl)) return data.pl;
  if (Array.isArray(data?.players)) return data.players;
  if (Array.isArray(data?.it)) return data.it;
  if (Array.isArray(data?.p)) return data.p;
  if (Array.isArray(data?.squad)) return data.squad;
  if (Array.isArray(data?.s?.pl)) return data.s.pl;
  if (Array.isArray(data?.s?.players)) return data.s.players;
  return [];
}

function parseLive(data) {
  const managers = [];
  const players = [];

  for (const user of parseUsers(data)) {
    const manager = parseManager(user) || {
      managerId: String(user?.u?.i ?? user?.i ?? user?.id ?? "").trim() || null,
      managerName: String(user?.u?.n ?? user?.n ?? user?.name ?? user?.unm ?? "").trim() || "Unbekannter Manager",
    };
    if (!manager.managerId) continue;
    managers.push(manager);

    for (const player of parsePlayerList(user)) {
      const parsed = parsePlayer(player, manager, { live: true });
      if (parsed) players.push(parsed);
    }
  }

  return { managers, players };
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

function playerMergeKey(player) {
  return player?.playerId ? `id:${player.playerId}` : `name:${normalize(player?.playerName)}`;
}

function mergePlayers(squadPlayers, livePlayers) {
  const map = new Map();
  for (const player of squadPlayers || []) {
    const key = playerMergeKey(player);
    if (key) map.set(key, player);
  }
  for (const player of livePlayers || []) {
    const key = playerMergeKey(player);
    if (!key) continue;
    const existing = map.get(key) || {};
    map.set(key, { ...existing, ...player, live: true });
  }
  return [...map.values()];
}

async function loadManagerDirectory(leagueId, liveManagers) {
  const discovered = [liveManagers];

  for (const path of [
    `/leagues/${leagueId}/settings/managers`,
    `/leagues/${leagueId}/ranking`,
  ]) {
    try {
      const data = await apiGet(path);
      discovered.push(parseManagerDirectory(data));
    } catch (error) {
      console.warn(`⚠️ Kickbase manager directory fallback failed for ${path}: ${error?.message || error}`);
    }
  }

  return mergeManagers(...discovered);
}

async function loadSquadPlayers(leagueId, managers) {
  const results = await Promise.all(managers.map(async manager => {
    try {
      const data = await apiGet(`/leagues/${leagueId}/managers/${manager.managerId}/squad`);
      return parsePlayerList(data)
        .map(player => parsePlayer(player, manager, { live: false }))
        .filter(Boolean);
    } catch (error) {
      console.warn(`⚠️ Kickbase squad lookup failed for ${manager.managerName} (${manager.managerId}): ${error?.message || error}`);
      return [];
    }
  }));

  return results.flat();
}

export async function getKickbaseLiveOwnership() {
  try {
    const leagueId = await resolveLeagueId();
    if (!leagueId) {
      return {
        ok: false,
        code: "LEAGUE_NOT_FOUND",
        error: `Kickbase-Liga \"${DEFAULT_LEAGUE_NAME}\" konnte nicht gefunden werden.`,
      };
    }

    const data = await apiGet(`/leagues/${leagueId}/live`);
    const live = parseLive(data);

    return {
      ok: true,
      leagueId,
      leagueName: DEFAULT_LEAGUE_NAME,
      managers: live.managers,
      players: live.players,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code || "API_ERROR",
      error: error?.message || "Kickbase-Live-Daten konnten nicht geladen werden.",
    };
  }
}

export async function getKickbaseOwnershipSnapshot({ force = false } = {}) {
  if (!force && ownershipCache.value && ownershipCache.expiresAt > Date.now()) {
    return ownershipCache.value;
  }

  try {
    const leagueId = await resolveLeagueId();
    if (!leagueId) {
      return {
        ok: false,
        code: "LEAGUE_NOT_FOUND",
        error: `Kickbase-Liga \"${DEFAULT_LEAGUE_NAME}\" konnte nicht gefunden werden.`,
      };
    }

    let live = { managers: [], players: [] };
    try {
      live = parseLive(await apiGet(`/leagues/${leagueId}/live`));
    } catch (error) {
      console.warn(`⚠️ Kickbase live ownership unavailable, continuing with squads: ${error?.message || error}`);
    }

    const managers = await loadManagerDirectory(leagueId, live.managers);
    const squadPlayers = await loadSquadPlayers(leagueId, managers);
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

    ownershipCache = { value, expiresAt: Date.now() + OWNERSHIP_CACHE_MS };
    return value;
  } catch (error) {
    return {
      ok: false,
      code: error?.code || "API_ERROR",
      error: error?.message || "Kickbase-Besitzerdaten konnten nicht geladen werden.",
    };
  }
}
