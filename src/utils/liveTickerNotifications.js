import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { buildKbbEmbed } from "./embeds.js";
import { getManagers } from "./managerStore.js";

// Production liveticker + notification role are intentionally fixed for this league.
// Stale hosting variables must not move the control or point it at an obsolete role.
export const LIVETICKER_CHANNEL_ID = "1549519679968510022";
export const LIVETICKER_NOTIFICATION_ROLE_ID = "1549523629811826708";
export const LIVETICKER_NOTIFICATION_BUTTON_ID = "kbb:liveticker-notifications:toggle:v2";

const CONTROL_MARKER = "KBB-LIVETICKER-NOTIFICATIONS-V2";
const OLD_CONTROL_MARKERS = ["KBB-LIVETICKER-NOTIFICATIONS-V1"];
const SEEDED_ROLE_PREFIX = "KBB-LIVETICKER-SEEDED-ROLE:";
const SEND_GUARD = Symbol.for("kbb.liveticker.notification.send.guard");

// Channels previously used by these feeds. A stale KBB_LIVETICKER_CHANNEL_ID
// from the host is included only so an old control message can be cleaned up.
const LEGACY_CONTROL_CHANNEL_IDS = [...new Set([
  process.env.KBB_LIVETICKER_CHANNEL_ID,
  "1522249187666952254", // former #kickbase-chat livefeed
  "1522249401735839784", // former #transfermarkt feed
].filter(id => id && id !== LIVETICKER_CHANNEL_ID))];

function buttonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(LIVETICKER_NOTIFICATION_BUTTON_ID)
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔔")
      .setLabel("Benachrichtigungen an / aus"),
  );
}

function controlEmbed({ seededRoleId = null } = {}) {
  const footerParts = ["187 KICKBASEBANDE", CONTROL_MARKER];
  if (seededRoleId) footerParts.push(`${SEEDED_ROLE_PREFIX}${seededRoleId}`);

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
    footer: footerParts.join(" • "),
  });
}

function messageHasControl(message) {
  if (!message) return false;
  for (const embed of message.embeds || []) {
    const footer = String(embed?.footer?.text || "");
    if ([CONTROL_MARKER, ...OLD_CONTROL_MARKERS].some(marker => footer.includes(marker))) return true;
  }
  for (const row of message.components || []) {
    for (const component of row.components || []) {
      const customId = component?.customId ?? component?.data?.custom_id;
      if (customId === LIVETICKER_NOTIFICATION_BUTTON_ID || String(customId || "").startsWith("kbb:liveticker-notifications:toggle:")) {
        return true;
      }
    }
  }
  return false;
}

function messageSeededForRole(message, roleId) {
  if (!message || !roleId) return false;
  return (message.embeds || []).some(embed =>
    String(embed?.footer?.text || "").includes(`${SEEDED_ROLE_PREFIX}${roleId}`));
}

async function fetchMember(guild, userId) {
  return guild.members.cache.get(userId)
    || await guild.members.fetch(userId).catch(() => null);
}

async function findControlMessages(channel, botUserId) {
  const controls = [];
  let before;

  // Search enough history that the settings message survives busy matchdays.
  for (let page = 0; page < 10; page += 1) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;

    for (const message of batch.values()) {
      if (message.author?.id === botUserId && messageHasControl(message)) controls.push(message);
    }
    if (controls.length) break;

    const oldest = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
    before = oldest?.id;
    if (!before || batch.size < 100) break;
  }

  return controls;
}

async function cleanupLegacyControlMessages(guild, botUserId) {
  for (const channelId of LEGACY_CONTROL_CHANNEL_IDS) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) continue;

    const controls = await findControlMessages(channel, botUserId);
    for (const message of controls) {
      await message.delete().catch(() => null);
    }
    if (controls.length) {
      console.log(`🧹 Removed ${controls.length} old liveticker control message(s) from channel ${channelId}.`);
    }
  }
}

async function seedCurrentManagers(guild, role) {
  if (!role?.editable) return { attempted: false, added: 0, failed: 0 };

  let added = 0;
  let failed = 0;
  for (const manager of getManagers(guild.id)) {
    const member = await fetchMember(guild, manager.userId);
    if (!member) {
      failed += 1;
      continue;
    }
    if (member.roles.cache.has(role.id)) continue;

    const ok = await member.roles.add(role, "KBB Liveticker notifications default-on migration")
      .then(() => true)
      .catch(error => {
        console.warn(`⚠️ Could not seed liveticker role for ${manager.userId}: ${error?.message || error}`);
        return false;
      });
    if (ok) added += 1;
    else failed += 1;
  }
  return { attempted: true, added, failed };
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

function escapePlainMentionName(value) {
  return String(value || "Manager")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`>|])/g, "\\$1")
    .replace(/@/g, "＠");
}

async function suppressDisabledMentionMarkup(guild, embeds, disabledUserIds) {
  if (!Array.isArray(embeds) || !disabledUserIds.length) return embeds;

  const replacements = new Map();
  await Promise.all(disabledUserIds.map(async userId => {
    const member = await fetchMember(guild, userId);
    replacements.set(userId, `@${escapePlainMentionName(member?.displayName || member?.user?.username || "Manager")}`);
  }));

  return embeds.map(embed => {
    const data = typeof embed?.toJSON === "function" ? embed.toJSON() : { ...embed };
    let description = data.description;
    if (typeof description === "string") {
      for (const [userId, replacement] of replacements.entries()) {
        description = description.replaceAll(`<@${userId}>`, replacement).replaceAll(`<@!${userId}>`, replacement);
      }
    }
    return { ...data, ...(typeof description === "string" ? { description } : {}) };
  });
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
      const disabled = requested.filter(userId => !enabled.has(userId));
      const embeds = await suppressDisabledMentionMarkup(guild, payload?.embeds, disabled);

      return originalSend({
        ...payload,
        ...(embeds ? { embeds } : {}),
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
    await cleanupLegacyControlMessages(guild, client.user?.id);

    const channel = await guild.channels.fetch(LIVETICKER_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || !channel?.messages?.fetch) {
      console.error(`❌ Liveticker channel ${LIVETICKER_CHANNEL_ID} not found or not writable.`);
      continue;
    }

    const controls = await findControlMessages(channel, client.user?.id);
    const sorted = controls.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    const keep = sorted[0] || null;

    for (const duplicate of sorted.slice(1)) {
      await duplicate.delete().catch(() => null);
    }

    const role = await guild.roles.fetch(LIVETICKER_NOTIFICATION_ROLE_ID).catch(() => null);
    let seededRoleId = keep && messageSeededForRole(keep, LIVETICKER_NOTIFICATION_ROLE_ID)
      ? LIVETICKER_NOTIFICATION_ROLE_ID
      : null;

    if (!seededRoleId && role?.editable) {
      const seeded = await seedCurrentManagers(guild, role);
      if (seeded.attempted) {
        seededRoleId = role.id;
        console.log(`🔔 Liveticker notification migration: added=${seeded.added}, failed=${seeded.failed}`);
      }
    } else if (!role) {
      console.warn(`⚠️ Liveticker notification role ${LIVETICKER_NOTIFICATION_ROLE_ID} not found.`);
    } else if (!role.editable && !seededRoleId) {
      console.warn(`⚠️ Liveticker notification role ${role.id} is not editable. Move the KBB bot role above it.`);
    }

    if (keep) {
      await keep.edit({ embeds: [controlEmbed({ seededRoleId })], components: [buttonRow()] }).catch(error => {
        console.warn(`⚠️ Could not refresh liveticker notification control: ${error?.message || error}`);
      });
      console.log(`🔔 Liveticker notification control restored in channel ${LIVETICKER_CHANNEL_ID}.`);
      continue;
    }

    await channel.send({
      embeds: [controlEmbed({ seededRoleId })],
      components: [buttonRow()],
    }).catch(error => {
      console.error(`❌ Could not create liveticker notification control: ${error?.message || error}`);
    });
  }
}

export async function handleLivetickerNotificationButton(interaction) {
  if (!interaction.isButton?.() || !String(interaction.customId || "").startsWith("kbb:liveticker-notifications:toggle:")) return false;

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
    await interaction.editReply(`❌ Die Liveticker-Benachrichtigungsrolle \`${LIVETICKER_NOTIFICATION_ROLE_ID}\` wurde nicht gefunden.`);
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
