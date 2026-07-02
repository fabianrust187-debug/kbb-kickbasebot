import fs from "fs";
import path from "path";

const FILE = path.resolve("src/data/guildSettings.json");

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
    console.error("❌ Failed to read guildSettings.json:", err?.message || err);
    return {};
  }
}

function write(data) {
  try {
    ensureFile();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("❌ Failed to write guildSettings.json:", err?.message || err);
    return false;
  }
}

export function getGuildSettings(guildId) {
  if (!guildId) return {};
  const data = read();
  return data[guildId] || {};
}

export function setGuildSettings(guildId, newData) {
  if (!guildId) return false;

  const data = read();
  data[guildId] = {
    ...(data[guildId] || {}),
    ...newData,
    updatedAt: new Date().toISOString(),
  };

  return write(data);
}

export function resetGuildSettings(guildId) {
  if (!guildId) return false;

  const data = read();
  delete data[guildId];
  return write(data);
}
