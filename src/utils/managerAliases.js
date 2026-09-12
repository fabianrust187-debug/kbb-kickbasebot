const DIRECT_ALIASES = new Map([
  ["forever20", "1527344409451040879"],
  ["sebastian", "849665679308357652"],
]);

// Kickbase display name -> Discord manager name from the managed 14-player roster.
// This avoids hard-coding a Discord ID when the existing manager roster already
// contains the correct Discord account.
const MANAGER_NAME_ALIASES = new Map([
  ["josephinerst", "josephine"],
  ["sebastian", "flyingbee"],
]);

export function normalizeManagerKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function applyManagerAliases(map) {
  if (!(map instanceof Map)) return map;

  for (const [name, userId] of DIRECT_ALIASES.entries()) {
    map.set(name, userId);
  }

  for (const [kickbaseName, discordManagerName] of MANAGER_NAME_ALIASES.entries()) {
    const userId = map.get(normalizeManagerKey(discordManagerName));
    if (userId) map.set(normalizeManagerKey(kickbaseName), userId);
  }

  return map;
}

export function resolveManagerAlias(name) {
  return DIRECT_ALIASES.get(normalizeManagerKey(name)) || null;
}
