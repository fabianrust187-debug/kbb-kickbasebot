import { getGuildSettings } from "./guildSettings.js";
import { cleanupTop5SubmitButtons, ensureTop5SubmitButton } from "./top5Button.js";
import { resetTop5Round } from "./top5Store.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";

export async function startTop5Round(guild, actor = null, { source = "manual", channelId = null } = {}) {
  const settings = getGuildSettings(guild.id);
  const resolvedChannelId = channelId || settings.top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
  const channel = await guild.channels.fetch(resolvedChannelId).catch(() => null);

  if (!channel?.isTextBased?.()) {
    return { ok: false, error: `Top-5-Channel ${resolvedChannelId} nicht gefunden oder nicht beschreibbar.` };
  }

  await cleanupTop5SubmitButtons(guild, { channelId: resolvedChannelId }).catch(() => null);

  const reset = resetTop5Round(guild.id, actor || guild.client.user);
  if (!reset.ok) {
    return { ok: false, error: reset.error || "Neue Top-5-Runde konnte nicht gestartet werden." };
  }

  const sourceLine = source === "scheduled"
    ? "📅 **Regulärer Wochenstart: Freitag, 20:00 Uhr.**"
    : "⚡ **Runde wurde von der Ligaleitung manuell gestartet.**";

  const marker = await channel.send({
    content: [
      "🔄 **Neue Top-5-Runde gestartet.**",
      sourceLine,
      "Die Top-5-Abgabe kann ab sofort eingereicht werden.",
      "**Frist: Dienstag, 22:00 Uhr**",
    ].join("\n"),
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (!marker) {
    return { ok: false, error: "Rundenstart wurde gespeichert, aber der Start-Hinweis konnte nicht gepostet werden." };
  }

  const button = await ensureTop5SubmitButton(guild, { channelId: resolvedChannelId }).catch(() => null);

  return {
    ok: true,
    source,
    channelId: resolvedChannelId,
    activeRound: reset.activeRound,
    marker,
    button,
  };
}
