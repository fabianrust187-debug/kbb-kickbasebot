const DEFAULT_ALIASES = new Map([
  ["forever20", "1527344409451040879"],
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
  for (const [name, userId] of DEFAULT_ALIASES.entries()) {
    map.set(name, userId);
  }
  return map;
}

export function resolveManagerAlias(name) {
  return DEFAULT_ALIASES.get(normalizeManagerKey(name)) || null;
}
