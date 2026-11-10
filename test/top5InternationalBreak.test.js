import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  shouldStartScheduledTop5Round,
  getUpcomingVerifiedTop5Schedule,
} from "../src/utils/top5ScheduleGate.js";

test("13 Nov 2026 is an international break, and 20 Nov is the verified Bundesliga restart", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("The verified November 2026 schedule must not need network access.");
  };
  try {
    const pause = await shouldStartScheduledTop5Round(new Date("2026-11-13T19:00:00Z"));
    assert.equal(pause.ok, true);
    assert.equal(pause.fridayKey, "2026-11-13");
    assert.equal(pause.shouldStart, false);
    assert.equal(pause.reason, "international-break");

    const stillPause = await shouldStartScheduledTop5Round(new Date("2026-11-17T18:00:00Z"));
    assert.equal(stillPause.shouldStart, false);

    const comeback = await shouldStartScheduledTop5Round(new Date("2026-11-20T19:00:00Z"));
    assert.equal(comeback.ok, true);
    assert.equal(comeback.fridayKey, "2026-11-20");
    assert.equal(comeback.shouldStart, true);
    assert.equal(comeback.fixtureCount, 9);

    const onDeadlineDay = await shouldStartScheduledTop5Round(new Date("2026-11-24T20:59:00Z"));
    assert.equal(onDeadlineDay.shouldStart, true);

    const outside = await shouldStartScheduledTop5Round(new Date("2026-11-24T21:00:00Z"));
    assert.equal(outside.shouldStart, false);
    assert.equal(outside.reason, "outside-regular-window");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("break notice remains visible until 20 Nov 20:00 Berlin time", () => {
  assert.equal(getUpcomingVerifiedTop5Schedule(new Date("2026-11-19T14:00:00Z")).nextSubmissionDeadline,
    "24.11.2026, 22:00 Uhr");
  assert.equal(getUpcomingVerifiedTop5Schedule(new Date("2026-11-20T18:30:00Z")).nextRoundStart,
    "20.11.2026, 20:00 Uhr");
  assert.equal(getUpcomingVerifiedTop5Schedule(new Date("2026-11-20T19:00:00Z")), null);
});

test("Friday 20 Nov round deadline is Tuesday 24 Nov 2026 at 22:00 Berlin", async () => {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kbb-november-break-"));
  try {
    process.chdir(tmp);
    fs.mkdirSync("src/data", { recursive: true });
    fs.writeFileSync("src/data/top5Submissions.json", JSON.stringify({
      "test-november-guild": {
        activeRound: {
          id: "verified-2026-11-20",
          createdAt: "2026-11-20T19:00:00.000Z",
          submissions: {},
          exemptions: {},
        },
      },
    }));
    const { getRoundDeadline, isTop5DeadlinePassed } = await import("../src/utils/top5Deadline.js");
    const deadline = getRoundDeadline("test-november-guild");
    assert.equal(deadline.dateKey, "2026-11-24");
    assert.equal(deadline.label, "24.11.2026 um 22:00 Uhr");
    assert.equal(isTop5DeadlinePassed("test-november-guild", new Date("2026-11-24T20:59:00Z")), false);
    assert.equal(isTop5DeadlinePassed("test-november-guild", new Date("2026-11-24T21:00:00Z")), true);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
