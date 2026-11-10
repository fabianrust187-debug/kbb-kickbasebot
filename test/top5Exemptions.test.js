import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the round/roster JSON files. Never touch production league data.
const originalCwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kbb-top5-exemptions-"));
process.chdir(tmp);
after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const { addManager } = await import("../src/utils/managerStore.js");
const {
  addTop5Submission,
  exemptTop5Manager,
  getTop5ExemptionForUser,
  getTop5Exemptions,
  getTop5Round,
  resetTop5Round,
  restoreTop5Exemptions,
} = await import("../src/utils/top5Store.js");
const {
  buildMissingTop5Message,
  finalizeTop5RoundIfComplete,
  getMissingTop5Managers,
} = await import("../src/utils/top5Deadline.js");
const { parseTop5ExemptionMessage } = await import("../src/utils/top5Recovery.js");

const guildId = "100000000000000001";
const admin = { id: "100000000000000100" };
const users = Array.from({ length: 13 }, (_, index) => ({
  id: String(100000000000000200n + BigInt(index)),
  username: `Manager ${index + 1}`,
}));

for (const user of users) {
  assert.equal(addManager(guildId, user, admin).ok, true);
}

function seedTwelve() {
  assert.equal(resetTop5Round(guildId, admin).ok, true);
  for (let index = 0; index < 12; index++) {
    assert.equal(addTop5Submission(guildId, users[index], `Spieler ${index + 1}`).ok, true);
  }
}

test("12 submissions plus a Friday-minus exemption complete the 13-manager round", async () => {
  seedTwelve();
  const before = getMissingTop5Managers(guildId);
  assert.equal(before.missing.length, 1);
  assert.equal(before.missing[0].userId, users[12].id);

  const exempt = exemptTop5Manager(guildId, users[12].id, admin, "Freitag im Minus");
  assert.equal(exempt.ok, true);
  assert.equal(exempt.completed, 13);
  assert.ok(getTop5Round(guildId).completedAt);

  const state = getMissingTop5Managers(guildId);
  assert.equal(state.submissions.length, 12);
  assert.equal(state.exempted.length, 1);
  assert.equal(state.missing.length, 0);
  assert.equal(state.failed.length, 0);
  assert.match(buildMissingTop5Message(state), /abgabepflichtigen Manager/);
  assert.match(buildMissingTop5Message(state), /Freitag im Minus/);

  // No fabricated player is saved for the exempt manager.
  assert.equal(getTop5Round(guildId).submissions[users[12].id], undefined);
  assert.equal(addTop5Submission(guildId, users[12], "Spieler 13").code, "EXEMPT");
  assert.equal(exemptTop5Manager(guildId, users[12].id, admin).code, "ALREADY_EXEMPT");

  const messages = [];
  const channel = {
    isTextBased: () => true,
    messages: { fetch: async () => new Map(messages.map((message, i) => [String(i), message])) },
    send: async payload => {
      const message = {
        ...payload,
        id: String(messages.length + 1),
        author: { id: admin.id },
        createdTimestamp: Date.now(),
      };
      messages.push(message);
      return message;
    },
  };
  const guild = {
    id: guildId,
    name: "Testliga",
    client: { user: admin },
    channels: { fetch: async () => channel },
  };
  const finalized = await finalizeTop5RoundIfComplete(guild, { source: "unit-test" });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.closed, true);
  assert.equal(finalized.exemptionCount, 1);
  assert.ok(getTop5Round(guildId).closedAt);
  assert.match(messages.at(-1).content, /12 Spielerabgaben \+ 1 Freistellung = 13\/13 erledigt/);

  const twice = await finalizeTop5RoundIfComplete(guild, { source: "unit-test" });
  assert.equal(twice.alreadyClosed, true);
  assert.equal(messages.length, 1);
});

test("exemptions survive Discord recovery but do not leak into a new round", () => {
  seedTwelve();
  const message = {
    content: [
      "🔓 **Top-5-Freistellung**",
      `Manager: <@${users[12].id}>`,
      "Grund: Freitag im Minus",
      `Freigestellt von: <@${admin.id}>`,
    ].join("\n"),
    createdAt: new Date(),
  };
  const parsed = parseTop5ExemptionMessage(message);
  assert.equal(parsed.userId, users[12].id);
  assert.equal(parsed.reason, "Freitag im Minus");
  assert.equal(restoreTop5Exemptions(guildId, [parsed, parsed]).restored, 1);
  assert.equal(restoreTop5Exemptions(guildId, [parsed]).restored, 0);
  assert.equal(getTop5Exemptions(guildId).length, 1);
  assert.equal(getMissingTop5Managers(guildId).missing.length, 0);

  assert.equal(resetTop5Round(guildId, admin).ok, true);
  assert.equal(getTop5Exemptions(guildId).length, 0);
  assert.equal(getTop5ExemptionForUser(guildId, users[12].id), null);
  assert.equal(getMissingTop5Managers(guildId).missing.length, 13);
});

test("cannot exempt somebody who already submitted or is not on the roster", () => {
  seedTwelve();
  assert.equal(exemptTop5Manager(guildId, users[0].id, admin).code, "ALREADY_SUBMITTED");
  assert.equal(exemptTop5Manager(guildId, "100000000000000999", admin).code, "NOT_A_MANAGER");
  assert.equal(getTop5Exemptions(guildId).length, 0);
});
