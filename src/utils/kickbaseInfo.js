const API_BASE = "https://api.kickbase.com/v4";
const REQUEST_TIMEOUT_MS = Number(process.env.KICKBASE_API_TIMEOUT_MS || 10000);

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  for (const key of ["it", "leagues", "l", "items", "results"]) {
    if (Array.isArray(data[key])) return data[key];
  }

  const firstArray = Object.values(data).find(Array.isArray);
  return firstArray || [];
}

function mapLeague(entry) {
  if (!entry || typeof entry !== "object") return null;

  const id = String(entry.i ?? entry.id ?? entry.leagueId ?? "").trim();
  const name = String(entry.n ?? entry.name ?? entry.leagueName ?? "").trim();
  if (!id && !name) return null;

  return {
    id: id || null,
    name: name || "Unbenannte Liga",
  };
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

  if (!email || !password) {
    return { ok: false, code: "NOT_CONFIGURED", error: "KICKBASE_EMAIL oder KICKBASE_PASSWORD fehlt." };
  }

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
    return {
      ok: false,
      code: "AUTH_FAILED",
      status: response.status,
      error: `Kickbase-Anmeldung fehlgeschlagen (${response.status}).`,
    };
  }

  return {
    ok: true,
    token: String(data.tkn),
    authMethod: "email_password",
  };
}

async function resolveToken() {
  const configuredToken = String(process.env.KICKBASE_TOKEN || "").trim();
  if (configuredToken) {
    return { ok: true, token: configuredToken, authMethod: "token" };
  }

  return login();
}

async function getLeagues(token) {
  const { response, data } = await fetchJson(`${API_BASE}/leagues`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return {
      ok: false,
      code: response.status === 401 ? "AUTH_FAILED" : "API_ERROR",
      status: response.status,
      error: `Kickbase-Ligen konnten nicht geladen werden (${response.status}).`,
    };
  }

  return {
    ok: true,
    leagues: extractArray(data).map(mapLeague).filter(Boolean),
  };
}

export async function getKickbaseConnectionInfo() {
  const wantedName = String(process.env.KICKBASE_LEAGUE_NAME || "187 KICKBASEBANDE").trim();
  const configuredLeagueId = String(process.env.KICKBASE_LEAGUE_ID || "").trim();
  const competitionId = String(process.env.KICKBASE_COMPETITION_ID || "1").trim();

  try {
    const auth = await resolveToken();
    if (!auth.ok) return auth;

    let leagueResult = await getLeagues(auth.token);

    if (!leagueResult.ok && leagueResult.status === 401 && auth.authMethod === "token") {
      const relogin = await login();
      if (relogin.ok) {
        leagueResult = await getLeagues(relogin.token);
        if (leagueResult.ok) auth.authMethod = relogin.authMethod;
      }
    }

    if (!leagueResult.ok) return leagueResult;

    const leagues = leagueResult.leagues;
    let selected = null;

    if (configuredLeagueId) {
      selected = leagues.find(league => String(league.id) === configuredLeagueId) || null;
    }

    if (!selected && wantedName) {
      const wanted = normalize(wantedName);
      selected = leagues.find(league => normalize(league.name) === wanted) || null;
    }

    return {
      ok: true,
      authMethod: auth.authMethod,
      competitionId,
      configuredLeagueId: configuredLeagueId || null,
      configuredLeagueName: wantedName || null,
      leagueFound: Boolean(selected),
      league: selected,
      leagueCount: leagues.length,
      leagues: leagues.slice(0, 20),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === "AbortError" ? "TIMEOUT" : "API_ERROR",
      error: error?.name === "AbortError"
        ? "Kickbase hat nicht rechtzeitig geantwortet."
        : (error?.message || "Kickbase-Verbindung konnte nicht geprüft werden."),
    };
  }
}
