import { getGuildSettings } from "./guildSettings.js";
import { getManagers } from "./managerStore.js";
import { ensureTop5SubmitButton } from "./top5Button.js";
import { isTop5DeadlinePassed } from "./top5Deadline.js";
import { getTop5Round, getTop5Submissions } from "./top5Store.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";
const TARGET = Number(process.env.TOP5_MANAGER_TARGET || 14);

async function ensureLateButtonForGuild(guild) {
  const round = getTop5Round(guild.id);
  if (!round?.id || round.closedAt) return;
  if (!isTop5DeadlinePassed(guild.id)) return;

  const submissions = getTop5Submissions(guild.id);
  const managers = getManagers(guild.id);
  const expected = managers.length || TARGET;

  // Once everybody has submitted, the normal Top-5 finalizer closes the round.
  if (submissions.length >= expected) return;

  const submittedIds = new Set(submissions.map(entry => String(entry.userId)));
  const missingManagers = managers.filter(manager => !submittedIds.has(String(manager.userId)));
  if (managers.length && !missingManagers.length) return;

  const settings = getGuildSettings(guild.id);
  const channelId = settings.top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
  const result = await ensureTop5SubmitButton(guild, { channelId });

  if (result.ok && result.created) {
    console.log(`⏰ Top-5 catch-up button restored for ${guild.name}: ${submissions.length}/${expected} submitted.`);
  }
}

export function startTop5LateSubmissionScheduler(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      await ensureLateButtonForGuild(guild).catch(error => {
        console.error(`❌ Top-5 catch-up button failed for ${guild.id}:`, error?.message || error);
      });
    }
  };

  setTimeout(() => run().catch(() => null), 12_000);
  return setInterval(() => run().catch(() => null), 60_000);
}
