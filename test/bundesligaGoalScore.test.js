import test from "node:test";
import assert from "node:assert/strict";
import { advanceBundesligaGoalScore } from "../src/utils/bundesligaGoalScore.js";

const teams = {
  home: { id: "freiburg" },
  away: { id: "bayern" },
};

test("own goal by Bayern player is credited to Freiburg, not Bayern", () => {
  const result = advanceBundesligaGoalScore({ home: 0, away: 2 }, {
    teamId: "freiburg", ownGoal: true, homeScore: 0, awayScore: 3,
  }, teams);
  assert.deepEqual(result, { home: 1, away: 2, verified: true, conflict: true });
});

test("later Bayern goal advances from corrected score to 1:3, not 0:4", () => {
  const ownGoal = advanceBundesligaGoalScore({ home: 0, away: 2 }, {
    teamId: "freiburg", ownGoal: true,
  }, teams);
  const next = advanceBundesligaGoalScore(ownGoal, {
    teamId: "bayern", homeScore: 0, awayScore: 4,
  }, teams);
  assert.equal(`${next.home}:${next.away}`, "1:3");
  assert.equal(next.conflict, true);
});

test("normal goal is credited to attacking team", () => {
  const next = advanceBundesligaGoalScore({ home: 0, away: 0 }, {
    teamId: "bayern", homeScore: 0, awayScore: 1,
  }, teams);
  assert.deepEqual(next, { home: 0, away: 1, verified: true, conflict: false });
});

test("when team id is missing, a consistent explicit score advances by one", () => {
  const next = advanceBundesligaGoalScore({ home: 0, away: 2 }, {
    homeScore: 1, awayScore: 2,
  }, teams);
  assert.deepEqual(next, { home: 1, away: 2, verified: true, conflict: false });
});

test("unknown credited team and inconsistent score do not invent a goal", () => {
  const next = advanceBundesligaGoalScore({ home: 0, away: 2 }, {
    homeScore: 0, awayScore: 4,
  }, teams);
  assert.deepEqual(next, { home: 0, away: 2, verified: false, conflict: false });
});

test("null explicit scores are not mistaken for 0:0", () => {
  const next = advanceBundesligaGoalScore({ home: 0, away: 0 }, {
    teamId: "bayern", homeScore: null, awayScore: null,
  }, teams);
  assert.deepEqual(next, { home: 0, away: 1, verified: true, conflict: false });
});
