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
