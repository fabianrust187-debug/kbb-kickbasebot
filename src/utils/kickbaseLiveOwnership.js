const API_BASE = "https://api.kickbase.com/v4";
const DEFAULT_LEAGUE_NAME = process.env.KICKBASE_LEAGUE_NAME || "187 KICKBASEBANDE";
const REQUEST_TIMEOUT_MS = Number(process.env.KICKBASE_API_TIMEOUT_MS || 10000);

let cachedToken = String(process.env.KICKBASE_TOKEN || "").trim() || null;
let cachedLeagueId = String(process.env.KICKBASE_LEAGUE_ID || "").trim() || null;

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
  if (Array.isArray(data)) return data;
  return [];
}

function parsePlayer(player, manager) {
  if (!player || typeof player !== "object") return null;

  const playerId = String(player.id ?? player.i ?? player.pi ?? "").trim() || null;
  const firstName = String(player.fn ?? player.firstName ?? "").trim();
  const lastName = String(player.n ?? player.ln ?? player.lastName ?? "").trim();
  const explicitName = String(player.name ?? "").trim();
  const playerName = [firstName, lastName].filter(Boolean).join(" ").trim() || explicitName || playerId;
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
  };
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
    const managers = [];
    const players = [];

    for (const user of parseUsers(data)) {
      const manager = {
        managerId: String(user?.id ?? user?.i ?? user?.u?.i ?? "").trim() || null,
        managerName: String(user?.n ?? user?.name ?? user?.unm ?? user?.u?.n ?? "").trim() || "Unbekannter Manager",
      };
      managers.push(manager);

      const userPlayers = Array.isArray(user?.pl)
        ? user.pl
        : Array.isArray(user?.players)
          ? user.players
          : [];

      for (const player of userPlayers) {
        const parsed = parsePlayer(player, manager);
        if (parsed) players.push(parsed);
      }
    }

    return {
      ok: true,
      leagueId,
      leagueName: DEFAULT_LEAGUE_NAME,
      managers,
      players,
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
