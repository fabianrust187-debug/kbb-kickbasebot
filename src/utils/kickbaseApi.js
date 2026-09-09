const API_BASE = "https://api.kickbase.com/v4";
const DEFAULT_COMPETITION_ID = process.env.KICKBASE_COMPETITION_ID || "1";
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

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const clean = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  for (const key of ["it", "players", "pl", "leagues", "l", "items", "results"]) {
    if (Array.isArray(data[key])) return data[key];
  }

  const firstArray = Object.values(data).find(Array.isArray);
  return firstArray || [];
}

function extractMarketValue(data) {
  if (data === null || data === undefined) return null;

  if (Array.isArray(data)) {
    for (let index = data.length - 1; index >= 0; index -= 1) {
      const value = extractMarketValue(data[index]);
      if (value !== null) return value;
    }
    return null;
  }

  if (typeof data !== "object") return null;

  for (const key of ["mv", "marketValue", "marketvalue", "value"]) {
    const value = asNumber(data[key]);
    if (value !== null && value >= 0) return value;
  }

  if (Array.isArray(data.it)) {
    const value = extractMarketValue(data.it);
    if (value !== null) return value;
  }

  return null;
}

function toPlayer(record) {
  if (!record || typeof record !== "object") return null;

  const id = String(record.i ?? record.id ?? record.pid ?? record.playerId ?? "").trim();
  if (!id) return null;

  const firstName = String(record.fn ?? record.firstName ?? record.firstname ?? "").trim();
  const lastName = String(record.ln ?? record.lastName ?? record.lastname ?? "").trim();
  const explicitName = String(record.n ?? record.name ?? "").trim();
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  const name = combined || explicitName || id;

  return {
    id,
    name,
    firstName,
    lastName,
    marketValue: extractMarketValue(record),
    raw: record,
  };
}

function playerScore(player, query) {
  const q = normalize(query);
  const full = normalize(player.name);
  const first = normalize(player.firstName);
  const last = normalize(player.lastName);

  if (!q || !full) return 0;
  if (full === q) return 100;
  if (last === q) return 96;
  if (first === q) return 90;
  if (full.startsWith(q) || full.endsWith(q)) return 86;

  const queryTokens = q.split(" ").filter(Boolean);
  if (queryTokens.length && queryTokens.every(token => full.includes(token))) return 82;
  if (full.includes(q)) return 78;

  return 0;
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
    body: JSON.stringify({
      em: email,
      loy: false,
      pass: password,
      rep: {},
    }),
  });

  if (!response.ok || !data?.tkn) {
    throw new Error(`Kickbase login failed (${response.status}).`);
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

async function apiGet(path, query = null) {
  let token = await getToken();
  if (!token) {
    const error = new Error("Kickbase API credentials are not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }

  const url = new URL(`${API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }

  const request = async (authToken) => fetchJson(url.toString(), {
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
  const leagues = extractArray(data);
  const wanted = normalize(DEFAULT_LEAGUE_NAME);

  const match = leagues.find(entry => normalize(entry?.n ?? entry?.name) === wanted);
  if (match) {
    cachedLeagueId = String(match.i ?? match.id ?? "").trim() || null;
    return cachedLeagueId;
  }

  return null;
}

async function searchPlayers(query) {
  const data = await apiGet(`/competitions/${DEFAULT_COMPETITION_ID}/players/search`, { query });
  return extractArray(data).map(toPlayer).filter(Boolean);
}

function choosePlayer(players, query) {
  const ranked = players
    .map(player => ({ player, score: playerScore(player, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length && players.length === 1) return { player: players[0], ambiguous: false };
  if (!ranked.length) return { player: null, ambiguous: false };

  const best = ranked[0];
  const second = ranked[1];
  if (second && best.score < 100 && second.score >= best.score - 3) {
    return { player: null, ambiguous: true, suggestions: ranked.slice(0, 5).map(entry => entry.player.name) };
  }

  return { player: best.player, ambiguous: false };
}

async function loadCurrentMarketValue(player) {
  let marketValue = player.marketValue;
  let detail = null;

  try {
    detail = await apiGet(`/competitions/${DEFAULT_COMPETITION_ID}/players/${player.id}`);
    marketValue = extractMarketValue(detail) ?? marketValue;
  } catch {
    // Competition detail is a convenience fallback; league data below is preferred when available.
  }

  let leagueId = null;
  try {
    leagueId = await resolveLeagueId();
  } catch {
    leagueId = null;
  }

  if (leagueId) {
    try {
      const leaguePlayer = await apiGet(`/leagues/${leagueId}/players/${player.id}`);
      marketValue = extractMarketValue(leaguePlayer) ?? marketValue;
      detail = leaguePlayer || detail;
    } catch {
      // Keep competition/search value if the league endpoint is temporarily unavailable.
    }

    if (marketValue === null) {
      try {
        const history = await apiGet(`/leagues/${leagueId}/players/${player.id}/marketValue/365`);
        marketValue = extractMarketValue(history);
      } catch {
        // Market value remains unavailable; the caller decides whether to fail open.
      }
    }
  }

  const detailPlayer = toPlayer(detail);
  return {
    marketValue,
    leagueId,
    officialName: detailPlayer?.name && detailPlayer.name !== player.id ? detailPlayer.name : player.name,
  };
}

export function isKickbaseApiConfigured() {
  return Boolean(
    String(process.env.KICKBASE_TOKEN || "").trim()
    || (String(process.env.KICKBASE_EMAIL || "").trim() && String(process.env.KICKBASE_PASSWORD || "")),
  );
}

export function formatMarketValue(value) {
  const number = asNumber(value);
  if (number === null) return "nicht verfügbar";
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(number))} €`;
}

export async function resolveKickbasePlayerMarketValue(inputName) {
  const submittedName = String(inputName || "").trim().replace(/\s+/g, " ");
  if (!submittedName) return { ok: false, code: "INVALID_NAME", error: "Kein Spielername angegeben." };

  if (!isKickbaseApiConfigured()) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      error: "Kickbase API ist noch nicht konfiguriert.",
      submittedName,
    };
  }

  try {
    const players = await searchPlayers(submittedName);
    const selected = choosePlayer(players, submittedName);

    if (selected.ambiguous) {
      return {
        ok: false,
        code: "AMBIGUOUS",
        error: "Spielername ist nicht eindeutig.",
        suggestions: selected.suggestions || [],
        submittedName,
      };
    }

    if (!selected.player) {
      return {
        ok: false,
        code: "NOT_FOUND",
        error: "Spieler wurde bei Kickbase nicht gefunden.",
        suggestions: players.slice(0, 5).map(player => player.name),
        submittedName,
      };
    }

    const current = await loadCurrentMarketValue(selected.player);
    return {
      ok: true,
      submittedName,
      playerId: selected.player.id,
      playerName: current.officialName || selected.player.name,
      marketValue: current.marketValue,
      fetchedAt: new Date().toISOString(),
      source: "kickbase-v4-unofficial",
      competitionId: DEFAULT_COMPETITION_ID,
      leagueId: current.leagueId,
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code || "API_ERROR",
      error: error?.message || "Kickbase API konnte nicht abgefragt werden.",
      submittedName,
    };
  }
}
