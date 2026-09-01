import fs from "fs";
import path from "path";

const FILE = path.resolve("src/data/managers.json");

function ensureFile() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}\n", "utf8");
}

function read() {
  try {
    ensureFile();
    return JSON.parse(fs.readFileSync(FILE, "utf8") || "{}");
  } catch (err) {
    console.error("❌ Failed to read managers.json:", err?.message || err);
    return {};
  }
}

function write(data) {
  try {
    ensureFile();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("❌ Failed to write managers.json:", err?.message || err);
    return false;
  }
}

export function getManagers(guildId) {
  if (!guildId) return [];
  const data = read();
  return Object.values(data[guildId]?.managers || {})
    .sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
}

export function addManager(guildId, user, actor = null) {
  if (!guildId || !user?.id) return { ok: false, error: "Guild oder User fehlt." };

  const data = read();
  if (!data[guildId]) data[guildId] = { managers: {} };
  if (!data[guildId].managers) data[guildId].managers = {};

  if (data[guildId].managers[user.id]) {
    return { ok: false, duplicate: true, manager: data[guildId].managers[user.id] };
  }

  const manager = {
    userId: user.id,
    username: user.username || user.tag || null,
    addedAt: new Date().toISOString(),
    addedBy: actor?.id || null,
  };

  data[guildId].managers[user.id] = manager;
  if (!write(data)) return { ok: false, error: "Managerliste konnte nicht gespeichert werden." };
  return { ok: true, manager, managers: Object.values(data[guildId].managers) };
}

export function removeManager(guildId, userId) {
  if (!guildId || !userId) return { ok: false, error: "Guild oder User fehlt." };

  const data = read();
  const manager = data[guildId]?.managers?.[userId] || null;
  if (!manager) return { ok: false, missing: true, error: "Dieser User ist nicht in der Managerliste." };

  delete data[guildId].managers[userId];
  if (!write(data)) return { ok: false, error: "Managerliste konnte nicht gespeichert werden." };
  return { ok: true, manager, managers: Object.values(data[guildId].managers) };
}
