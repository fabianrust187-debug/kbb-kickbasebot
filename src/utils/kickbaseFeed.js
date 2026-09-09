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
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
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

function extractFeed(data) {
  if (Array.isArray(data?.af)) return data.af;
  if (Array.isArray(data?.it)) return data.it;
  if (Array.isArray(data)) return data;
  return [];
}

function fullPlayerName(detail, fallback) {
  if (!detail || typeof detail !== "object") return fallback;

  const source = detail.p && typeof detail.p === "object" ? detail.p : detail;
  const firstName = String(source.fn ?? source.firstName ?? "").trim();
  const lastName = String(source.ln ?? source.n ?? source.lastName ?? source.name ?? "").trim();
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return combined || fallback;
}

async function loadPlayerName(leagueId, playerId, fallback) {
  if (!playerId) return fallback;

  try {
    const detail = await apiGet(`/leagues/${leagueId}/players/${playerId}`);
    return fullPlayerName(detail, fallback);
  } catch {
    try {
      const detail = await apiGet(`/competitions/${DEFAULT_COMPETITION_ID}/players/${playerId}`);
      return fullPlayerName(detail, fallback);
    } catch {
      return fallback;
    }
  }
}

function toTransfer(entry) {
  if (!entry || Number(entry.t) !== 15 || !entry.data || typeof entry.data !== "object") return null;

  const data = entry.data;
  const buyer = String(data.byr || "").trim();
  if (!buyer) return null;

  const seller = String(data.slr || "").trim() || "KICKBASE";
  const playerName = String(data.pn || "").trim() || "Unbekannter Spieler";
  const playerId = String(data.pi || "").trim() || null;
  const price = asNumber(data.trp);
  const createdAt = entry.dt ? new Date(entry.dt).toISOString() : null;

  return {
    activityId: String(entry.i || "").trim() || null,
    buyer,
    seller,
    playerId,
    playerName,
    price,
    createdAt,
    raw: entry,
  };
}

function dedupeTransfers(transfers) {
  const seen = new Set();
  const result = [];

  for (const transfer of transfers) {
    const key = transfer.activityId
      || [transfer.createdAt, transfer.buyer, transfer.seller, transfer.playerId, transfer.price].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(transfer);
  }

  return result;
}

export function formatTransferPrice(value) {
  const number = asNumber(value);
  if (number === null) return "Preis unbekannt";
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(number))} €`;
}

export async function getLatestLeagueTransfers({ limit = 10 } = {}) {
  const safeLimit = Math.max(1, Math.min(15, Number(limit) || 10));

  try {
    const leagueId = await resolveLeagueId();
    if (!leagueId) {
      return {
        ok: false,
        code: "LEAGUE_NOT_FOUND",
        error: `Kickbase-Liga \"${DEFAULT_LEAGUE_NAME}\" konnte nicht gefunden werden.`,
      };
    }

    const data = await apiGet(`/leagues/${leagueId}/activitiesFeed`, {
      start: 0,
      max: Math.max(50, safeLimit * 4),
    });

    const transfers = dedupeTransfers(
      extractFeed(data)
        .map(toTransfer)
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    ).slice(0, safeLimit);

    const enriched = await Promise.all(transfers.map(async transfer => ({
      ...transfer,
      playerName: await loadPlayerName(leagueId, transfer.playerId, transfer.playerName),
    })));

    return {
      ok: true,
      leagueId,
      leagueName: DEFAULT_LEAGUE_NAME,
      transfers: enriched,
      fetchedAt: new Date().toISOString(),
      source: "kickbase-v4-unofficial-activitiesFeed",
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code || "API_ERROR",
      error: error?.message || "Kickbase-Feed konnte nicht geladen werden.",
    };
  }
}
