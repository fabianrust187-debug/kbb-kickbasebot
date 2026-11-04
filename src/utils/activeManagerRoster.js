import { getManagers, removeManager } from "./managerStore.js";

// 187 KICKBASEBANDE: Raps left the league on 04 November 2026.
// Legacy Discloud installations may still have TOP5_MANAGER_TARGET=14.
// This fixed active-league setting deliberately overrides that stale value.
export const ACTIVE_MANAGER_TARGET = 13;
export const RETIRED_MANAGER_ALIASES = new Set(["raps"]);

export function normalizedManagerName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isRetiredManagerName(...names) {
  return names.some(name => RETIRED_MANAGER_ALIASES.has(normalizedManagerName(name)));
}

function isMissingMember(error) {
  return error?.code === 10007 || error?.status === 404
    || /Unknown Member/i.test(String(error?.message || ""));
}

// Run at startup, after loading the old Discord roster. Only confirmed
// departures are removed. Temporary Discord API outages must not delete
// legitimate managers. The remaining 13-manager roster is backed up to
// Discord by ensureManagerRosterSnapshot.
export async function reconcileActiveManagerRoster(guild) {
  const managers = getManagers(guild.id);
  const removed = [];
  const unresolved = [];

  for (const manager of managers) {
    let member = guild.members.cache.get(manager.userId);
    let missing = false;
    if (!member) {
      try { member = await guild.members.fetch(manager.userId); }
      catch (error) {
        if (isMissingMember(error)) missing = true;
        else {
          unresolved.push(manager.userId);
          console.warn(`⚠️ Manager membership not confirmed for ${manager.userId}: ${error?.message || error}`);
        }
      }
    }

    // The member's username may differ from their Kickbase nickname.
    // If they already left Discord, attempt to resolve the stored global
    // account name instead of guessing their id.
    let globalUser = member?.user || null;
    if (!globalUser && !manager.username) {
      globalUser = await guild.client.users.fetch(manager.userId).catch(() => null);
    }
    const retired = isRetiredManagerName(
      manager.username,
      member?.displayName,
      member?.nickname,
      member?.user?.username,
      member?.user?.globalName,
      globalUser?.username,
      globalUser?.globalName,
    );

    if (!retired && !missing) continue;
    const result = removeManager(guild.id, manager.userId);
    if (result.ok) {
      removed.push(manager);
      console.log(`👋 KBB manager departed: ${manager.userId} (${manager.username || "unknown"}); guild-member-missing=${missing}`);
    }
  }

  return {
    removed,
    unresolved,
    count: getManagers(guild.id).length,
    target: ACTIVE_MANAGER_TARGET,
  };
}
