import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getGuildSettings } from "./guildSettings.js";
import { addManager, getManagers } from "./managerStore.js";
import { isTop5DeadlinePassed } from "./top5Deadline.js";
import { TOP5_BUTTON_PREFIX } from "./top5Button.js";
import { getTop5Round, getTop5SubmissionForUser } from "./top5Store.js";

const DEFAULT_TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";
const TOP5_TARGET = Number(process.env.TOP5_MANAGER_TARGET || 14);

function getTop5ChannelId(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.top5ChannelId || DEFAULT_TOP5_CHANNEL_ID;
}

export async function handleTop5Button(interaction) {
  if (!interaction.isButton?.() || !interaction.customId?.startsWith(TOP5_BUTTON_PREFIX)) return false;

  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "❌ Nur auf dem KBB-Server nutzbar.", ephemeral: true });
    return true;
  }

  const top5ChannelId = getTop5ChannelId(interaction.guildId);
  if (String(interaction.channelId) !== String(top5ChannelId)) {
    await interaction.reply({ content: `❌ Top-5-Abgaben sind nur in <#${top5ChannelId}> möglich.`, ephemeral: true });
    return true;
  }

  const clickedRoundId = interaction.customId.slice(TOP5_BUTTON_PREFIX.length);
  const activeRound = getTop5Round(interaction.guildId);
  if (!activeRound?.id || activeRound.id !== clickedRoundId) {
    await interaction.reply({ content: "🔄 Dieser Button gehört zu einer bereits beendeten Top-5-Runde. Bitte nutze den aktuellen Button weiter unten im Channel.", ephemeral: true });
    return true;
  }

  if (isTop5DeadlinePassed(interaction.guildId)) {
    await interaction.reply({ content: "⏰ Die Top-5-Abgabefrist für diese Runde ist bereits beendet. Die nächste Runde startet automatisch.", ephemeral: true });
    return true;
  }

  const existing = getTop5SubmissionForUser(interaction.guildId, interaction.user.id);
  if (existing) {
    await interaction.reply({ content: `✅ Du hast in dieser Runde bereits **${existing.playerName}** abgegeben.`, ephemeral: true });
    return true;
  }

  const managers = getManagers(interaction.guildId);
  const registered = managers.some(manager => manager.userId === interaction.user.id);
  if (!registered) {
    if (managers.length >= TOP5_TARGET) {
      await interaction.reply({ content: "❌ Die KBB-Managerliste ist bereits vollständig und du bist dort nicht eingetragen.", ephemeral: true });
      return true;
    }

    const added = addManager(interaction.guildId, interaction.user, interaction.user);
    if (!added.ok && !added.duplicate) {
      await interaction.reply({ content: "❌ Deine Top-5-Abgabe konnte nicht vorbereitet werden. Bitte kurz bei der Ligaleitung melden.", ephemeral: true });
      return true;
    }
  }

  const modal = new ModalBuilder()
    .setCustomId(`kbb_top5_submit:${interaction.guildId}:${interaction.user.id}`)
    .setTitle("Top-5-Spieler abgeben");

  const input = new TextInputBuilder()
    .setCustomId("player_name")
    .setLabel("Welchen Spieler gibst du ab?")
    .setPlaceholder("z.B. Manuel Neuer")
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(80)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
  return true;
}
