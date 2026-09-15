import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { buildKbbEmbed } from "./embeds.js";
import { getManagers } from "./managerStore.js";

export const LIVETICKER_CHANNEL_ID = process.env.KBB_LIVETICKER_CHANNEL_ID || "1549519679968510022";
export const LIVETICKER_NOTIFICATION_ROLE_ID = process.env.KBB_LIVETICKER_NOTIFICATION_ROLE_ID || "1549520307646107699";
export const LIVETICKER_NOTIFICATION_BUTTON_ID = "kbb:liveticker-notifications:toggle:v1";

const CONTROL_MARKER = "KBB-LIVETICKER-NOTIFICATIONS-V1";
const HISTORY_SCAN_LIMIT = 100;
const SEND_GUARD = Symbol.for("kbb.liveticker.notification.send.guard");

function buttonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(LIVETICKER_NOTIFICATION_BUTTON_ID)
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔔")
      .setLabel("Benachrichtigungen an / aus"),
  );
}

function controlEmbed() {
  return buildKbbEmbed({
    title: "🔔 Liveticker-Benachrichtigungen",
    description: [
      "Hier kannst du selbst festlegen, ob der KBB Bot dich bei Ereignissen im Liveticker aktiv markieren darf.",
      "",
      `**Benachrichtigungsrolle:** <@&${LIVETICKER_NOTIFICATION_ROLE_ID}>`,
      "",
      "🔔 **Rolle aktiv:** Du wirst bei deinen Spielern bzw. Transfers markiert.",
      "🔕 **Rolle aus:** Die Meldung bleibt sichtbar, du erhältst aber keinen Ping vom Bot.",
      "",
      "Drücke den Button erneut, um deinen aktuellen Status jederzeit umzuschalten.",
    ].join("\n"),
    footer: `187 KICKBASEBANDE • ${CONTROL_MARKER}`,
  });
}

function messageHasControl(message) {
  if (!message) return false;
  for (const embed of message.embeds || []) {
    if (String(embed?.footer?.text || "").includes(CONTROL_MARKER)) return true;
  }
  for (const row of message.components || []) {
    for (const component of row.components || []) {
      const customId = component?.customId ?? component?.data?.custom_id;
      if (customId === LIVETICKER_NOTIFICATION_BUTTON_ID) return true;
    }
  }
  return false;
}

async function fetchMember(guild, userId) {
  return guild.members.cache.get(userId)
    || await guild.members.fetch(userId).catch(() => null);
}

async function seedCurrentManagers(guild, role) {
  if (!role?.editable) return { added: 0, failed: 0 };

  let added = 0;
  let failed = 0;
  for (const manager of getManagers(guild.id)) {
    const member = await fetchMember(guild, manager.userId);
    if (!member || member.roles.cache.has(role.id)) continue;
    const ok = await member.roles.add(role, "KBB Liveticker notifications default-on migration")
      .then(() => true)
      .catch(error => {
        console.warn(`⚠️ Could not seed liveticker role for ${manager.userId}: ${error?.message || error}`);
        return false;
      });
    if (ok) added += 1;
    else failed += 1;
  }
  return { added, failed };
}

export async function getLivetickerNotificationEnabledUserIds(guild, userIds) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  const enabled = new Set();

  await Promise.all(uniqueIds.map(async userId => {
    const member = await fetchMember(guild, userId);
    if (member?.roles?.cache?.has(LIVETICKER_NOTIFICATION_ROLE_ID)) enabled.add(userId);
  }));

  return enabled;
}

export async function installLivetickerNotificationSendGuard(client) {
  for (const guild of client.guilds.cache.values()) {
    const channel = await guild.channels.fetch(LIVETICKER_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || typeof channel.send !== "function" || channel[SEND_GUARD]) continue;

    const originalSend = channel.send.bind(channel);
    Object.defineProperty(channel, SEND_GUARD, { value: true, enumerable: false });

    channel.send = async payload => {
      const requested = Array.isArray(payload?.allowedMentions?.users)
        ? payload.allowedMentions.users.map(String)
        : [];

      if (!requested.length) return originalSend(payload);

      const enabled = await getLivetickerNotificationEnabledUserIds(guild, requested);
      return originalSend({
        ...payload,
        allowedMentions: {
          ...(payload.allowedMentions || {}),
          users: requested.filter(userId => enabled.has(userId)),
          parse: [],
        },
      });
    };

    console.log(`🔔 Liveticker notification send-guard active in ${guild.name}.`);
  }
}

export async function ensureLivetickerNotificationControl(client) {
  for (const guild of client.guilds.cache.values()) {
    const channel = await guild.channels.fetch(LIVETICKER_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) continue;

    const recent = await channel.messages.fetch({ limit: HISTORY_SCAN_LIMIT }).catch(() => null);
    const controls = recent
      ? [...recent.values()].filter(message => message.author?.id === client.user?.id && messageHasControl(message))
      : [];

    if (controls.length) {
      const sorted = controls.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const keep = sorted[0];
      await keep.edit({ embeds: [controlEmbed()], components: [buttonRow()] }).catch(error => {
        console.warn(`⚠️ Could not refresh liveticker notification control: ${error?.message || error}`);
      });
      for (const duplicate of sorted.slice(1)) {
        await duplicate.delete().catch(() => null);
      }
      console.log(`🔔 Liveticker notification control restored in ${guild.name}.`);
      continue;
    }

    // First migration only: preserve the previous behaviour (notifications enabled
    // for current league managers). After the control message exists, every member
    // owns the preference through the role toggle and restarts never re-enable it.
    const role = await guild.roles.fetch(LIVETICKER_NOTIFICATION_ROLE_ID).catch(() => null);
    if (role) {
      const seeded = await seedCurrentManagers(guild, role);
      console.log(`🔔 Liveticker notification migration: added=${seeded.added}, failed=${seeded.failed}`);
    } else {
      console.warn(`⚠️ Liveticker notification role ${LIVETICKER_NOTIFICATION_ROLE_ID} not found.`);
    }

    await channel.send({ embeds: [controlEmbed()], components: [buttonRow()] }).catch(error => {
      console.error(`❌ Could not create liveticker notification control: ${error?.message || error}`);
    });
  }
}

export async function handleLivetickerNotificationButton(interaction) {
  if (!interaction.isButton?.() || interaction.customId !== LIVETICKER_NOTIFICATION_BUTTON_ID) return false;

  if (!interaction.guild) {
    await interaction.reply({ content: "❌ Diese Einstellung ist nur auf dem Server verfügbar.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const [member, role] = await Promise.all([
    fetchMember(interaction.guild, interaction.user.id),
    interaction.guild.roles.fetch(LIVETICKER_NOTIFICATION_ROLE_ID).catch(() => null),
  ]);

  if (!member) {
    await interaction.editReply("❌ Dein Server-Mitglied konnte nicht geladen werden.");
    return true;
  }
  if (!role) {
    await interaction.editReply("❌ Die Liveticker-Benachrichtigungsrolle wurde nicht gefunden.");
    return true;
  }
  if (!role.editable) {
    await interaction.editReply("❌ Der Bot kann diese Rolle aktuell nicht verwalten. Die KBB-Bot-Rolle muss in der Rollen-Hierarchie über der Benachrichtigungsrolle stehen.");
    return true;
  }

  const active = member.roles.cache.has(role.id);
  if (active) {
    await member.roles.remove(role, "User disabled KBB liveticker notifications");
    await interaction.editReply("🔕 **Liveticker-Benachrichtigungen deaktiviert.** Die Feed-Meldungen bleiben sichtbar, aber der Bot pingt dich dort nicht mehr.");
  } else {
    await member.roles.add(role, "User enabled KBB liveticker notifications");
    await interaction.editReply("🔔 **Liveticker-Benachrichtigungen aktiviert.** Der Bot darf dich bei deinen Spielern bzw. Transfers wieder pingen.");
  }

  return true;
}
