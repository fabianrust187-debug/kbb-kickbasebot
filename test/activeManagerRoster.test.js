import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_MANAGER_TARGET,
  isRetiredManagerName,
  normalizedManagerName,
} from "../src/utils/activeManagerRoster.js";

test("KBB league currently requires 13 active managers", () => {
  assert.equal(ACTIVE_MANAGER_TARGET, 13);
});

test("Raps is excluded regardless of capitalization", () => {
  assert.equal(isRetiredManagerName("Raps"), true);
  assert.equal(isRetiredManagerName("rapS"), true);
  assert.equal(isRetiredManagerName("RAPS"), true);
  assert.equal(isRetiredManagerName("JANNES", "Raps"), true);
  assert.equal(isRetiredManagerName("JANNES", "FlyingBee"), false);
});

test("manager name normalization is stable across display formats", () => {
  assert.equal(normalizedManagerName(" RapS "), "raps");
  assert.equal(normalizedManagerName("TrooperDaDom60"), "trooperdadom60");
});
