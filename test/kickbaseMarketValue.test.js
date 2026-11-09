import test from "node:test";
import assert from "node:assert/strict";

// The module captures env config when imported. No real Kickbase credentials
// or network calls are used by these tests.
process.env.KICKBASE_TOKEN = "market-value-test-token";
process.env.KICKBASE_COMPETITION_ID = "1";
process.env.KICKBASE_LEAGUE_ID = "9058282";

const { resolveKickbasePlayerMarketValue } = await import("../src/utils/kickbaseApi.js?unit-test-mw");

function reply(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("temporary HTTP 429 is retried; market value is returned", async () => {
  const previousFetch = globalThis.fetch;
  let searches = 0;
  let detailCalls = 0;

  globalThis.fetch = async url => {
    const path = String(url);
    if (path.includes("/players/search")) {
      searches++;
      if (searches === 1) return reply(429, { error: "rate limited" });
      return reply(200, { it: [{ pi: "42", fn: "Test", ln: "Tietz", mv: 13500000 }] });
    }
    if (path.includes("/leagues/9058282/players/42")) {
      detailCalls++;
      return reply(200, { i: "42", fn: "Test", ln: "Tietz", mv: 13500000 });
    }
    return reply(404, { error: "unexpected path" });
  };

  try {
    const result = await resolveKickbasePlayerMarketValue("Tietz");
    assert.equal(result.ok, true);
    assert.equal(result.marketValue, 13500000);
    assert.equal(searches, 2);
    assert.equal(detailCalls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("player with no valid market value reports VALUE_MISSING, not a successful 0-value lookup", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes("/players/search")) {
      return reply(200, { it: [{ pi: "73", fn: "Example", ln: "Missing" }] });
    }
    return reply(404, { error: "not available" });
  };

  try {
    const result = await resolveKickbasePlayerMarketValue("Example Missing");
    assert.equal(result.ok, false);
    assert.equal(result.code, "VALUE_MISSING");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Top-5 entry Möller resolves David Møller Wolfe from an alternate Kickbase spelling", async () => {
  const previousFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/players/search")) {
      const query = parsed.searchParams.get("query");
      queries.push(query);
      return reply(200, { it: query === "Møller"
        ? [{ pi: "351", fn: "David", ln: "Møller Wolfe", mv: 9800000 }]
        : [] });
    }
    if (parsed.pathname.endsWith("/leagues/9058282/players/351")) {
      return reply(200, { i: "351", fn: "David", ln: "Møller Wolfe", mv: 9800000 });
    }
    return reply(404, {});
  };

  try {
    const result = await resolveKickbasePlayerMarketValue("Möller");
    assert.equal(result.ok, true);
    assert.equal(result.playerName, "David Møller Wolfe");
    assert.equal(result.playerId, "351");
    assert.equal(result.marketValue, 9800000);
    assert.ok(queries.includes("Möller"));
    assert.ok(queries.includes("Møller"));
    assert.equal(new Set(queries.map(q => q.toLowerCase())).size, queries.length);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("ambiguous Möller variants are rejected instead of guessing a player", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/players/search")) {
      const query = parsed.searchParams.get("query");
      if (query === "Möller") return reply(200, { it: [{ pi: "351", fn: "David", ln: "Möller Wolfe", mv: 9800000 }] });
      if (query === "Møller") return reply(200, { it: [{ pi: "777", fn: "Martin", ln: "Møller Wolfe", mv: 4000000 }] });
      return reply(200, { it: [] });
    }
    return reply(404, {});
  };

  try {
    const result = await resolveKickbasePlayerMarketValue("Möller");
    assert.equal(result.ok, false);
    assert.equal(result.code, "AMBIGUOUS");
    assert.deepEqual(result.suggestions, ["David Möller Wolfe", "Martin Møller Wolfe"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
